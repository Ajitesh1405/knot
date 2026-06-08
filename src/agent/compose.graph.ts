import { Logger } from '@nestjs/common';
import {
  StateGraph,
  START,
  END,
  interrupt,
  Annotation,
} from '@langchain/langgraph';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { GmailService } from '../gmail/gmail.service';
import {
  ComposeSpecialist,
  Candidate,
  EmailDraft,
} from './compose.specialist';

// ─── What the user can decide at the approval gate ──────────────────
export type ApproveDecision = {
  action: 'approve' | 'edit' | 'replace' | 'cancel';
  correction?: string; // free-text instruction, only for 'edit' (AI revise)
  body?: string; // verbatim replacement body, only for 'replace'
};

// ─── Interrupt payloads surfaced to the Telegram layer ──────────────
export type SenderOption = {
  index: number;
  label: string; // "Sarah Mehta <sarah@acme.com>"
  address: string;
  subject: string;
};
export type ChooseSenderInterrupt = {
  kind: 'choose_sender';
  recipient: string;
  candidates: SenderOption[];
};
export type ApproveInterrupt = {
  kind: 'approve';
  draft: EmailDraft;
};
export type ComposeInterrupt = ChooseSenderInterrupt | ApproveInterrupt;

// ─── Graph state ────────────────────────────────────────────────────
const ComposeState = Annotation.Root({
  userId: Annotation<string>(),
  instruction: Annotation<string>(),
  recipient: Annotation<string>(),
  intent: Annotation<string>(),
  candidates: Annotation<Candidate[]>(),
  chosen: Annotation<Candidate | undefined>(),
  newTo: Annotation<string | undefined>(), // brand-new email to this address
  draft: Annotation<EmailDraft | undefined>(),
  decision: Annotation<ApproveDecision | undefined>(),
  status: Annotation<string>(), // '' | sent | cancelled | no_match
});

type Deps = {
  compose: ComposeSpecialist;
  gmail: GmailService;
  checkpointer: PostgresSaver;
  logger: Logger;
};

// ─── Build & compile the compose HITL graph ─────────────────────────
// Flow: resolve → [chooseSender?] → draft → approve ⇄ redraft → send
export function buildComposeGraph({
  compose,
  gmail,
  checkpointer,
  logger,
}: Deps) {
  // resolve: parse intent + find distinct senders matching the name.
  const resolve = async (s: typeof ComposeState.State) => {
    const { recipient, intent } = await compose.parseIntent(s.instruction);
    const candidates = await compose.resolveCandidates(s.userId, recipient);
    logger.log(
      `[${s.userId}] resolve: recipient="${recipient}" candidates=${candidates.length}`,
    );
    if (candidates.length === 0) {
      // No thread to reply to — if the recipient is a bare address, fall
      // through to composing a brand-new email; otherwise give up.
      if (compose.isEmail(recipient))
        return { recipient, intent, newTo: recipient };
      return { recipient, intent, status: 'no_match' };
    }
    if (candidates.length === 1)
      return { recipient, intent, candidates, chosen: candidates[0] };
    return { recipient, intent, candidates };
  };

  // chooseSender: ask the user which "Sarah" when >1 distinct sender.
  const chooseSender = async (s: typeof ComposeState.State) => {
    const options: SenderOption[] = s.candidates.map((c, index) => ({
      index,
      label: c.from,
      address: gmail.addressOf(c.from),
      subject: c.subject,
    }));
    const payload: ChooseSenderInterrupt = {
      kind: 'choose_sender',
      recipient: s.recipient,
      candidates: options,
    };
    const choice = interrupt<typeof payload, { index: number }>(payload);
    const chosen = s.candidates[choice?.index] ?? s.candidates[0];
    logger.log(`[${s.userId}] sender chosen: ${gmail.addressOf(chosen.from)}`);
    return { chosen };
  };

  // draft: produce the body — either a reply to a chosen sender, or a
  // brand-new email when there was no thread to reply to.
  const draft = async (s: typeof ComposeState.State) => {
    const d = s.chosen
      ? await compose.draftReply(s.userId, s.chosen, s.intent)
      : await compose.draftNew(s.userId, s.newTo!, s.intent);
    logger.log(`[${s.userId}] draft_created → ${d.recipientName} | ${d.subject}`);
    return { draft: d };
  };

  // approve: the human gate. Pauses here until Telegram resumes.
  const approve = async (s: typeof ComposeState.State) => {
    logger.log(`[${s.userId}] awaiting_approval → ${s.draft?.recipientName}`);
    const decision = interrupt<ApproveInterrupt, ApproveDecision>({
      kind: 'approve',
      draft: s.draft!,
    });
    logger.log(`[${s.userId}] decision: ${decision?.action}`);
    return { decision };
  };

  // redraft: apply free-text correction (AI revise), then loop to approve.
  const redraft = async (s: typeof ComposeState.State) => {
    const d = await compose.redraft(s.draft!, s.decision?.correction ?? '');
    logger.log(`[${s.userId}] redrafted → ${d.recipientName}`);
    return { draft: d, decision: undefined };
  };

  // replaceBody: use the user's verbatim text as the body, then loop to approve.
  const replaceBody = (s: typeof ComposeState.State) => {
    const body = (s.decision?.body ?? '').trim();
    logger.log(`[${s.userId}] body replaced verbatim → ${s.draft?.recipientName}`);
    return { draft: { ...s.draft!, body }, decision: undefined };
  };

  // send: actually deliver the email via Gmail.
  const send = async (s: typeof ComposeState.State) => {
    const d = s.draft!;
    const res = await gmail.send(s.userId, {
      to: d.to,
      subject: d.subject,
      body: d.body,
      threadId: d.threadId,
      inReplyTo: d.inReplyTo,
    });
    logger.log(`[${s.userId}] sent → ${d.to} (msg ${res.id})`);
    return { status: 'sent' };
  };

  const cancelled = (s: typeof ComposeState.State) => {
    logger.log(`[${s.userId}] cancelled → ${s.draft?.recipientName ?? '?'}`);
    return { status: 'cancelled' };
  };

  return new StateGraph(ComposeState)
    .addNode('resolve', resolve)
    .addNode('chooseSender', chooseSender)
    .addNode('drafting', draft)
    .addNode('approve', approve)
    .addNode('redraft', redraft)
    .addNode('replaceBody', replaceBody)
    .addNode('send', send)
    .addNode('cancelled', cancelled)
    .addEdge(START, 'resolve')
    .addConditionalEdges(
      'resolve',
      (s) =>
        s.status === 'no_match'
          ? 'end'
          : (s.candidates?.length ?? 0) > 1
            ? 'choose'
            : 'draft',
      { choose: 'chooseSender', draft: 'drafting', end: END },
    )
    .addEdge('chooseSender', 'drafting')
    .addEdge('drafting', 'approve')
    .addConditionalEdges(
      'approve',
      (s) =>
        s.decision?.action === 'approve'
          ? 'send'
          : s.decision?.action === 'edit'
            ? 'redraft'
            : s.decision?.action === 'replace'
              ? 'replace'
              : 'cancel',
      {
        send: 'send',
        redraft: 'redraft',
        replace: 'replaceBody',
        cancel: 'cancelled',
      },
    )
    .addEdge('redraft', 'approve')
    .addEdge('replaceBody', 'approve')
    .addEdge('send', END)
    .addEdge('cancelled', END)
    .compile({ checkpointer });
}

export type ComposeGraph = ReturnType<typeof buildComposeGraph>;
