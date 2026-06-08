import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Subject } from 'rxjs';
import { Command } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { PrismaService } from '../prisma/prisma.service';
import { GmailService } from '../gmail/gmail.service';
import { ComposeSpecialist } from './compose.specialist';
import {
  buildComposeGraph,
  ComposeGraph,
  ComposeInterrupt,
  ApproveDecision,
} from './compose.graph';

const TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const SWEEP_MS = 60 * 1000; // scan every minute
const LIVE = ['awaiting_approval', 'awaiting_sender', 'awaiting_edit'];

// What the Telegram layer should do after a run/resume.
export type HitlOutcome =
  | { type: 'interrupt'; draftId: string; payload: ComposeInterrupt }
  | { type: 'done'; draftId: string; status: string; recipient: string }
  | { type: 'error'; draftId: string; message: string };

@Injectable()
export class ComposeHitlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ComposeHitlService.name);
  private checkpointer!: PostgresSaver;
  private graph!: ComposeGraph;
  private sweepTimer?: NodeJS.Timeout;

  // Telegram subscribes to this to notify the user when a draft auto-expires.
  readonly expired$ = new Subject<{
    draftId: string;
    chatId?: string;
    recipient: string;
  }>();

  // Telegram subscribes to this for drafts kicked off via natural language
  // (the supervisor 'compose' route) — the card arrives async.
  readonly events$ = new Subject<{ chatId: string; outcome: HitlOutcome }>();

  constructor(
    private readonly compose: ComposeSpecialist,
    private readonly gmail: GmailService,
    private readonly db: PrismaService,
  ) {}

  async onModuleInit() {
    // Own Postgres schema so the checkpointer's tables never collide with
    // Prisma's `public` schema (migrations stay clean).
    this.checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!, {
      schema: 'langgraph',
    });
    await this.checkpointer.setup(); // creates the schema + checkpoint tables
    this.graph = buildComposeGraph({
      compose: this.compose,
      gmail: this.gmail,
      checkpointer: this.checkpointer,
      logger: this.logger,
    });
    this.sweepTimer = setInterval(
      () => void this.sweepExpired(),
      SWEEP_MS,
    );
    this.logger.log('Compose HITL graph ready');
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ─── Kick off a new compose flow ────────────────────────────────────
  async start(
    userId: string,
    chatId: string,
    instruction: string,
  ): Promise<HitlOutcome> {
    const draftId = randomUUID();
    await this.db.pendingDraft.create({
      data: { id: draftId, userId, chatId, status: 'awaiting_approval' },
    });
    this.logger.log(`[${userId}] draft_created id=${draftId}`);
    const config = { configurable: { thread_id: draftId } };
    try {
      const result = await this.graph.invoke(
        { userId, instruction, status: '' },
        config,
      );
      return this.interpret(draftId, result);
    } catch (err: any) {
      await this.fail(draftId, err.message);
      return { type: 'error', draftId, message: err.message };
    }
  }

  // ─── Fire-and-forget entry from the supervisor 'compose' route ──────
  // Returns an ack immediately; the draft card arrives async via events$.
  kickoff(userId: string, message: string): string {
    const chatId = userId.startsWith('tg-') ? userId.slice(3) : userId;
    void this.start(userId, chatId, message)
      .then((outcome) => this.events$.next({ chatId, outcome }))
      .catch((err) =>
        this.events$.next({
          chatId,
          outcome: { type: 'error', draftId: '', message: err.message },
        }),
      );
    return '✍️ Drafting a reply…';
  }

  // ─── Resume after a Telegram button / edit text ─────────────────────
  async resume(draftId: string, resume: unknown): Promise<HitlOutcome> {
    const config = { configurable: { thread_id: draftId } };
    try {
      const result = await this.graph.invoke(new Command({ resume }), config);
      return this.interpret(draftId, result);
    } catch (err: any) {
      await this.fail(draftId, err.message);
      return { type: 'error', draftId, message: err.message };
    }
  }

  // Convenience wrappers for the three approval actions.
  approve(draftId: string) {
    return this.resume(draftId, { action: 'approve' } as ApproveDecision);
  }
  cancel(draftId: string) {
    return this.resume(draftId, { action: 'cancel' } as ApproveDecision);
  }
  applyEdit(draftId: string, correction: string) {
    return this.resume(draftId, {
      action: 'edit',
      correction,
    } as ApproveDecision);
  }
  // Use the user's verbatim text as the email body (manual edit).
  replaceBody(draftId: string, body: string) {
    return this.resume(draftId, { action: 'replace', body } as ApproveDecision);
  }
  chooseSender(draftId: string, index: number) {
    return this.resume(draftId, { index });
  }

  // Mark that we're waiting for the user's free-text correction. The graph
  // stays paused at `approve`; the next text message resolves it.
  async markAwaitingEdit(draftId: string) {
    await this.db.pendingDraft.update({
      where: { id: draftId },
      data: { status: 'awaiting_edit' },
    });
  }

  // ─── Registry helpers for the Telegram layer ────────────────────────
  attachMessage(draftId: string, chatId: string, messageId: string) {
    return this.db.pendingDraft.update({
      where: { id: draftId },
      data: { chatId, messageId },
    });
  }

  listPending(userId: string) {
    return this.db.pendingDraft.findMany({
      where: { userId, status: { in: LIVE } },
      orderBy: { createdAt: 'asc' },
    });
  }

  findAwaitingEdit(userId: string) {
    return this.db.pendingDraft.findFirst({
      where: { userId, status: 'awaiting_edit' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Re-fetch the current interrupt payload (for re-presenting via /pending).
  async currentInterrupt(draftId: string): Promise<ComposeInterrupt | null> {
    const config = { configurable: { thread_id: draftId } };
    const state = await this.graph.getState(config);
    const intr = (state.tasks?.[0]?.interrupts ?? [])[0] as
      | { value: ComposeInterrupt }
      | undefined;
    return intr?.value ?? null;
  }

  // ─── Map graph result → outcome + update the registry ───────────────
  private async interpret(
    draftId: string,
    result: Record<string, any>,
  ): Promise<HitlOutcome> {
    const intr = (result.__interrupt__ ?? [])[0] as
      | { value: ComposeInterrupt }
      | undefined;

    if (intr?.value) {
      const payload = intr.value;
      if (payload.kind === 'choose_sender') {
        await this.db.pendingDraft.update({
          where: { id: draftId },
          data: { status: 'awaiting_sender', recipient: payload.recipient },
        });
      } else {
        await this.db.pendingDraft.update({
          where: { id: draftId },
          data: {
            status: 'awaiting_approval',
            recipient: payload.draft.recipientName,
            subject: payload.draft.subject,
          },
        });
      }
      return { type: 'interrupt', draftId, payload };
    }

    // Terminal: sent | cancelled | no_match
    const status = (result.status as string) || 'cancelled';
    const recipient = result.draft?.recipientName ?? result.recipient ?? '';
    await this.db.pendingDraft.update({
      where: { id: draftId },
      data: { status, recipient },
    });
    return { type: 'done', draftId, status, recipient };
  }

  private async fail(draftId: string, message: string) {
    this.logger.error(`[draft ${draftId}] error: ${message}`);
    await this.db.pendingDraft
      .update({ where: { id: draftId }, data: { status: 'error' } })
      .catch(() => undefined);
  }

  // ─── 1-hour timeout: auto-cancel stale drafts ───────────────────────
  private async sweepExpired() {
    try {
      const cutoff = new Date(Date.now() - TIMEOUT_MS);
      const stale = await this.db.pendingDraft.findMany({
        where: { status: { in: LIVE }, createdAt: { lt: cutoff } },
      });
      for (const d of stale) {
        await this.db.pendingDraft.update({
          where: { id: d.id },
          data: { status: 'expired' },
        });
        this.logger.log(`expired → ${d.recipient || d.id} (no decision in 1h)`);
        this.expired$.next({
          draftId: d.id,
          chatId: d.chatId ?? undefined,
          recipient: d.recipient,
        });
      }
    } catch (err: any) {
      this.logger.error(`sweepExpired failed: ${err.message}`);
    }
  }
}
