import { Logger } from '@nestjs/common';
import {
  StateGraph,
  START,
  END,
  interrupt,
  Annotation,
} from '@langchain/langgraph';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { CalendarService } from '../calendar/calendar.service';
import {
  SchedulerSpecialist,
  SchedulerIntent,
  ResolvedAttendee,
  MeetingProposal,
} from './scheduler.specialist';

// ─── Decisions / interrupt payloads ─────────────────────────────────
export type SchedulerDecision = {
  action: 'send' | 'edit' | 'cancel';
  feedback?: string; // free-text, only for 'edit'
};
export type NeedEmailInterrupt = { kind: 'need_email'; names: string[] };
export type ApproveMeetingInterrupt = {
  kind: 'approve_meeting';
  proposal: MeetingProposal;
  startLabel: string;
  durationMins: number;
};
export type SchedulerInterrupt = NeedEmailInterrupt | ApproveMeetingInterrupt;

// ─── Graph state ────────────────────────────────────────────────────
const SchedulerState = Annotation.Root({
  userId: Annotation<string>(),
  message: Annotation<string>(),
  intent: Annotation<SchedulerIntent | undefined>(),
  resolved: Annotation<ResolvedAttendee[]>(),
  unresolved: Annotation<string[]>(),
  proposal: Annotation<MeetingProposal | undefined>(),
  decision: Annotation<SchedulerDecision | undefined>(),
  status: Annotation<string>(), // '' | scheduled | cancelled | no_slot | no_attendees
  meetLink: Annotation<string>(),
  htmlLink: Annotation<string>(),
});

type Deps = {
  scheduler: SchedulerSpecialist;
  calendar: CalendarService;
  checkpointer: PostgresSaver;
  logger: Logger;
};

export function buildSchedulerGraph({
  scheduler,
  calendar,
  checkpointer,
  logger,
}: Deps) {
  // parse intent + resolve attendee emails (never invents).
  const parse = async (s: typeof SchedulerState.State) => {
    const intent = await scheduler.parseIntent(s.message);
    const res = await scheduler.resolveAttendees(s.userId, intent.attendees);
    logger.log(
      `[${s.userId}] scheduler parse: "${intent.summary}" ` +
        `attendees=${intent.attendees.length} resolved=${res.resolved.length} ` +
        `unresolved=${res.unresolved.length}`,
    );
    if (intent.attendees.length === 0) {
      return { intent, resolved: [], unresolved: [], status: 'no_attendees' };
    }
    return { intent, resolved: res.resolved, unresolved: res.unresolved };
  };

  // Ask the user for any address we couldn't resolve. Loops until all known.
  const askEmail = async (s: typeof SchedulerState.State) => {
    const provided = interrupt<NeedEmailInterrupt, string>({
      kind: 'need_email',
      names: s.unresolved,
    });
    const emails = (provided ?? '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/g) ?? [];
    const resolved = [...s.resolved];
    const stillMissing: string[] = [];
    s.unresolved.forEach((name, i) => {
      if (emails[i]) resolved.push({ name, email: emails[i] });
      else stillMissing.push(name);
    });
    logger.log(
      `[${s.userId}] scheduler email-resolve: +${emails.length}, missing=${stillMissing.length}`,
    );
    return { resolved, unresolved: stillMissing };
  };

  // Find the first slot that works for everyone.
  const findSlot = async (s: typeof SchedulerState.State) => {
    const proposal = await scheduler.proposeSlot(
      s.userId,
      s.intent!,
      s.resolved,
    );
    if (!proposal) {
      logger.log(`[${s.userId}] scheduler: no_slot`);
      return { status: 'no_slot' };
    }
    return { proposal };
  };

  // Human approval gate.
  const approve = async (s: typeof SchedulerState.State) => {
    const tz = await calendar.primaryTimeZone(s.userId);
    const startLabel = calendar.formatDateTime(s.proposal!.startISO, tz);
    logger.log(
      `[${s.userId}] awaiting_approval → ${s.proposal!.summary} @ ${startLabel}`,
    );
    const decision = interrupt<ApproveMeetingInterrupt, SchedulerDecision>({
      kind: 'approve_meeting',
      proposal: s.proposal!,
      startLabel,
      durationMins: s.intent!.durationMins || 30,
    });
    logger.log(`[${s.userId}] scheduler decision: ${decision?.action}`);
    return { decision };
  };

  // Apply free-text feedback, then re-find a slot.
  const revise = async (s: typeof SchedulerState.State) => {
    const r = await scheduler.revise(
      {
        durationMins: s.intent!.durationMins,
        timeHint: s.intent!.timeHint,
        summary: s.intent!.summary,
      },
      s.decision?.feedback ?? '',
    );
    logger.log(`[${s.userId}] scheduler revised → ${r.timeHint}, ${r.durationMins}min`);
    return {
      intent: { ...s.intent!, ...r },
      decision: undefined,
    };
  };

  // Create the event with a Meet link + email invites.
  const create = async (s: typeof SchedulerState.State) => {
    const p = s.proposal!;
    const res = await calendar.createEvent(s.userId, {
      summary: p.summary,
      start: p.startISO,
      end: p.endISO,
      attendees: p.attendees,
      withMeet: true,
    });
    logger.log(`[${s.userId}] scheduled event ${res.id}`);
    return { status: 'scheduled', meetLink: res.hangoutLink, htmlLink: res.htmlLink };
  };

  const cancelled = (s: typeof SchedulerState.State) => {
    logger.log(`[${s.userId}] scheduler cancelled`);
    return { status: 'cancelled' };
  };

  return new StateGraph(SchedulerState)
    .addNode('parse', parse)
    .addNode('askEmail', askEmail)
    .addNode('findSlot', findSlot)
    .addNode('approve', approve)
    .addNode('revise', revise)
    .addNode('create', create)
    .addNode('cancelled', cancelled)
    .addEdge(START, 'parse')
    .addConditionalEdges(
      'parse',
      (s) =>
        s.status === 'no_attendees'
          ? 'end'
          : s.unresolved.length > 0
            ? 'ask'
            : 'slot',
      { ask: 'askEmail', slot: 'findSlot', end: END },
    )
    .addConditionalEdges(
      'askEmail',
      (s) => (s.unresolved.length > 0 ? 'ask' : 'slot'),
      { ask: 'askEmail', slot: 'findSlot' },
    )
    .addConditionalEdges(
      'findSlot',
      (s) => (s.status === 'no_slot' ? 'end' : 'approve'),
      { approve: 'approve', end: END },
    )
    .addConditionalEdges(
      'approve',
      (s) =>
        s.decision?.action === 'send'
          ? 'send'
          : s.decision?.action === 'edit'
            ? 'edit'
            : 'cancel',
      { send: 'create', edit: 'revise', cancel: 'cancelled' },
    )
    .addEdge('revise', 'findSlot')
    .addEdge('create', END)
    .addEdge('cancelled', END)
    .compile({ checkpointer });
}

export type SchedulerGraph = ReturnType<typeof buildSchedulerGraph>;
