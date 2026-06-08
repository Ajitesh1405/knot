import { Injectable, Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Runnable } from '@langchain/core/runnables';
import { CalendarService, CalRange, Meeting } from '../calendar/calendar.service';
import { BriefingService } from '../calendar/briefing.service';
import { GraphService } from '../graph/graph.service';
import { LlmService } from 'src/llm/llm.service';

// Parameters the supervisor extracts for calendar queries.
export type CalendarRunParams = {
  timeRange?: 'today' | 'tomorrow' | 'this_week' | 'unspecified';
};

@Injectable()
export class CalendarSpecialist {
  private readonly logger = new Logger(CalendarSpecialist.name);
  private readonly summaryChain: Runnable<Record<string, string>, string>;

  constructor(
    private readonly calendar: CalendarService,
    private readonly briefing: BriefingService,
    private readonly graph: GraphService,
    private readonly llm: LlmService,
  ) {
    const model = this.llm.build('fast');

    this.summaryChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You summarize a calendar for a busy user on Telegram. ' +
          "Write naturally, like you're texting a friend.\n" +
          'RULES:\n' +
          '- One short line per meeting: time — title — who.\n' +
          '- Lead with the soonest.\n' +
          '- No markdown headers or bullet symbols. Max 8 lines.\n' +
          '- Use 📅 sparingly. If nothing matters, say so briefly.',
      ],
      ['user', 'Range: {range}\nTimezone: {tz}\n\nMeetings:\n{meetings}'],
    ])
      .pipe(model)
      .pipe(new StringOutputParser());
  }

  // ─── Supervisor entry point ─────────────────────────────────────────
  async run(
    userId: string,
    question: string,
    params?: CalendarRunParams,
  ): Promise<string> {
    // "what's my next meeting", "brief me", "who's coming" → rich briefing
    // instead of the one-line list. Lets users skip the /next meeting command.
    if (
      /\b(brief|prepare|prep me|next meeting|upcoming meeting|who('?s| is) (coming|attending|in))\b/i.test(
        question,
      )
    ) {
      try {
        return await this.briefing.briefUpcoming(userId);
      } catch (err: any) {
        return err.message;
      }
    }

    const requested = params?.timeRange ?? 'today';
    const range: CalRange = requested === 'unspecified' ? 'today' : requested;
    this.logger.log(`[calendar-spec] range=${range}`);

    let meetings: Meeting[];
    try {
      meetings = await this.calendar.listForRange(userId, range);
    } catch (err: any) {
      return err.message; // e.g. "Calendar not connected…"
    }

    if (meetings.length === 0) {
      const label =
        range === 'today'
          ? 'today'
          : range === 'tomorrow'
            ? 'tomorrow'
            : 'this week';
      return `Nothing on your calendar ${label}. 🎉`;
    }

    // Store attendees/meetings in the graph (failures never block the reply).
    const tz = await this.calendar.primaryTimeZone(userId);
    for (const m of meetings) {
      try {
        await this.extractAndStore(userId, m);
      } catch (err: any) {
        this.logger.warn(`extract failed for "${m.title}": ${err.message}`);
      }
    }

    const meetingsText = meetings
      .map((m) => {
        const who = m.attendees
          .filter((a) => !a.self)
          .map((a) => a.name || a.email)
          .filter(Boolean)
          .join(', ');
        return `- ${this.calendar.formatStart(m, tz)} | ${m.title}${who ? ` | ${who}` : ''}`;
      })
      .join('\n');

    try {
      const summary = await this.summaryChain.invoke({
        range,
        tz,
        meetings: meetingsText,
      });
      return summary || meetingsText;
    } catch (err: any) {
      this.logger.error(`summary failed: ${err.message}`);
      return meetingsText; // fall back to the raw list
    }
  }

  // ─── Attendees → Person nodes; ATTENDS / ORGANIZED_BY relations ─────
  private async extractAndStore(userId: string, m: Meeting) {
    await this.graph.upsertNode(userId, 'Meeting', m.title);

    // The user themselves attends.
    if (m.attendees.some((a) => a.self)) {
      await this.graph.upsertRelation(userId, 'User', 'ATTENDS', m.title);
    }

    for (const a of m.attendees) {
      if (a.self) continue;
      const person = a.name || this.localPart(a.email);
      if (!person) continue;
      await this.graph.upsertNode(userId, 'Person', person);
      await this.graph.upsertRelation(userId, person, 'ATTENDS', m.title);
    }

    if (m.organizer) {
      const org = m.organizer.name || this.localPart(m.organizer.email);
      if (org) {
        await this.graph.upsertNode(userId, 'Person', org);
        await this.graph.upsertRelation(userId, m.title, 'ORGANIZED_BY', org);
      }
    }
  }

  private localPart(email: string): string {
    return email ? email.split('@')[0].replace(/[._-]+/g, ' ') : '';
  }
}
