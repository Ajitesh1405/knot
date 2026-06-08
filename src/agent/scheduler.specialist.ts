import { Injectable, Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';
import { CalendarService, FreeSlot } from '../calendar/calendar.service';
import { GmailService } from '../gmail/gmail.service';
import { LlmService } from 'src/llm/llm.service';

// ─── Structured intent pulled from the user's request ───────────────
const IntentSchema = z.object({
  attendees: z
    .array(z.string())
    .describe(
      'A JSON array of people to invite (names or emails), as written. ' +
        'Return an empty array [] if no one is named. ' +
        'Must always be an array — never a bare string, never "<UNKNOWN>".',
    ),
  durationMins: z.number().describe('Meeting length in minutes; default 30.'),
  timeHint: z
    .string()
    .describe('When, verbatim: "tomorrow morning", "next Tuesday", etc.'),
  summary: z.string().describe('A short, specific meeting title.'),
});
export type SchedulerIntent = z.infer<typeof IntentSchema>;

const ReviseSchema = z.object({
  durationMins: z.number(),
  timeHint: z.string(),
  summary: z.string(),
});

export type ResolvedAttendee = { name: string; email: string };
export type Resolution = {
  resolved: ResolvedAttendee[];
  unresolved: string[]; // names we couldn't find an address for
};

// A concrete meeting proposal awaiting approval.
export type MeetingProposal = {
  summary: string;
  startISO: string;
  endISO: string;
  attendees: string[]; // emails
  attendeeLabels: string[]; // "Name <email>" for display
};

@Injectable()
export class SchedulerSpecialist {
  private readonly logger = new Logger(SchedulerSpecialist.name);
  private readonly intentChain: Runnable<Record<string, string>, SchedulerIntent>;
  private readonly reviseChain: Runnable<
    Record<string, string>,
    z.infer<typeof ReviseSchema>
  >;

  constructor(
    private readonly calendar: CalendarService,
    private readonly gmail: GmailService,
    private readonly llm: LlmService,
  ) {
    const smart = this.llm.build('smart');
    const fast = this.llm.build('fast');

    this.intentChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'Extract meeting-scheduling intent from the request. ' +
          'attendees = the people to invite (names or emails, as written). ' +
          'durationMins defaults to 30 if unstated. ' +
          'timeHint = the timing phrase verbatim. ' +
          'summary = a short, specific title inferred from context.',
      ],
      ['user', '{message}'],
    ]).pipe(smart.withStructuredOutput(IntentSchema));

    this.reviseChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'The user wants to change a proposed meeting. Given the current ' +
          'proposal and their feedback, output the updated durationMins, ' +
          'timeHint, and summary. Keep unchanged fields as-is.',
      ],
      [
        'user',
        'Current: duration={duration}min, when="{timeHint}", title="{summary}".\n' +
          'Feedback: {feedback}',
      ],
    ]).pipe(fast.withStructuredOutput(ReviseSchema));
  }

  async parseIntent(message: string): Promise<SchedulerIntent> {
    try {
      return await this.intentChain.invoke({ message });
    } catch (err: any) {
      // Don't crash the flow — fall back to "no attendees" so the graph asks
      // who to invite instead of erroring out.
      this.logger.warn(`intent parse failed, degrading: ${err.message}`);
      return { attendees: [], durationMins: 30, timeHint: '', summary: 'Meeting' };
    }
  }

  revise(
    prev: { durationMins: number; timeHint: string; summary: string },
    feedback: string,
  ) {
    return this.reviseChain.invoke({
      duration: String(prev.durationMins),
      timeHint: prev.timeHint,
      summary: prev.summary,
      feedback,
    });
  }

  // ─── Resolve names → emails. NEVER invents an address. ──────────────
  async resolveAttendees(
    userId: string,
    names: string[],
  ): Promise<Resolution> {
    const resolved: ResolvedAttendee[] = [];
    const unresolved: string[] = [];

    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;

      // Already an email? Take it as-is.
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
        resolved.push({ name, email: name });
        continue;
      }

      // Otherwise search Gmail for a real sender by that name.
      try {
        const [hit] = await this.gmail.findCandidateSenders(userId, name, 1);
        const email = hit ? this.gmail.addressOf(hit.from) : '';
        if (email) {
          resolved.push({ name, email });
          continue;
        }
      } catch (err: any) {
        this.logger.warn(`resolve "${name}" failed: ${err.message}`);
      }
      unresolved.push(name); // ask the user — do not guess
    }
    return { resolved, unresolved };
  }

  // ─── Propose the first slot that works for everyone ─────────────────
  async proposeSlot(
    userId: string,
    intent: SchedulerIntent,
    resolved: ResolvedAttendee[],
  ): Promise<MeetingProposal | null> {
    const tz = await this.calendar.primaryTimeZone(userId);
    const { start, end } = this.calendar.buildWindow(tz, intent.timeHint);
    const slots: FreeSlot[] = await this.calendar.findFreeSlots(userId, {
      attendees: resolved.map((r) => r.email),
      durationMins: intent.durationMins || 30,
      windowStart: start,
      windowEnd: end,
      limit: 1,
    });
    if (slots.length === 0) return null;

    const slot = slots[0];
    return {
      summary: intent.summary,
      startISO: slot.start,
      endISO: slot.end,
      attendees: resolved.map((r) => r.email),
      attendeeLabels: resolved.map((r) =>
        r.name === r.email ? r.email : `${r.name} <${r.email}>`,
      ),
    };
  }
}
