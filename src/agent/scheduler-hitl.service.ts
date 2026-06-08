import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Subject } from 'rxjs';
import { Command } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { SchedulerSpecialist } from './scheduler.specialist';
import {
  buildSchedulerGraph,
  SchedulerGraph,
  SchedulerInterrupt,
  SchedulerDecision,
} from './scheduler.graph';

// Pushed to the Telegram layer as the background graph run progresses.
export type SchedulerEvent =
  | {
      kind: 'interrupt';
      userId: string;
      chatId: string;
      draftId: string;
      payload: SchedulerInterrupt;
    }
  | {
      kind: 'done';
      userId: string;
      chatId: string;
      draftId: string;
      status: string;
      summary: string;
      startLabel: string;
      meetLink: string;
      htmlLink: string;
    }
  | {
      kind: 'error';
      userId: string;
      chatId: string;
      draftId: string;
      message: string;
    };

@Injectable()
export class SchedulerHitlService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerHitlService.name);
  private checkpointer!: PostgresSaver;
  private graph!: SchedulerGraph;

  readonly events$ = new Subject<SchedulerEvent>();

  constructor(
    private readonly scheduler: SchedulerSpecialist,
    private readonly calendar: CalendarService,
    private readonly db: PrismaService,
  ) {}

  async onModuleInit() {
    // Same dedicated schema as compose — keeps Prisma's `public` clean.
    this.checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!, {
      schema: 'langgraph',
    });
    await this.checkpointer.setup(); // idempotent; shares the checkpoint tables
    this.graph = buildSchedulerGraph({
      scheduler: this.scheduler,
      calendar: this.calendar,
      checkpointer: this.checkpointer,
      logger: this.logger,
    });
    this.logger.log('Scheduler HITL graph ready');
  }

  // In private Telegram chats chatId == the numeric part of "tg-<id>".
  private chatIdFor(userId: string): string {
    return userId.startsWith('tg-') ? userId.slice(3) : userId;
  }

  // ─── Entry from the supervisor loop. Returns immediately; the approval
  //     card arrives async via events$ once a slot is found. ───────────
  async start(userId: string, message: string): Promise<string> {
    const draftId = randomUUID();
    const chatId = this.chatIdFor(userId);
    await this.db.meetingDraft.create({
      data: { id: draftId, userId, chatId, status: 'awaiting_approval' },
    });
    this.logger.log(`[${userId}] scheduler draft ${draftId} started`);
    void this.run(draftId, userId, chatId, { userId, message, status: '' });
    return '🔍 Finding a free slot…';
  }

  // ─── Resume after a button / provided email / edit feedback ─────────
  async resume(draftId: string, resume: unknown): Promise<void> {
    const d = await this.db.meetingDraft.findUnique({ where: { id: draftId } });
    if (!d) return;
    const chatId = d.chatId ?? this.chatIdFor(d.userId);
    void this.run(draftId, d.userId, chatId, new Command({ resume }));
  }

  approve(draftId: string) {
    return this.resume(draftId, { action: 'send' } as SchedulerDecision);
  }
  cancel(draftId: string) {
    return this.resume(draftId, { action: 'cancel' } as SchedulerDecision);
  }
  applyEdit(draftId: string, feedback: string) {
    return this.resume(draftId, { action: 'edit', feedback } as SchedulerDecision);
  }
  provideEmail(draftId: string, text: string) {
    return this.resume(draftId, text); // askEmail resumes with the raw text
  }

  async markAwaitingEdit(draftId: string) {
    await this.db.meetingDraft.update({
      where: { id: draftId },
      data: { status: 'awaiting_edit' },
    });
  }
  attachMessage(draftId: string, chatId: string, messageId: string) {
    return this.db.meetingDraft.update({
      where: { id: draftId },
      data: { chatId, messageId },
    });
  }
  findAwaitingEdit(userId: string) {
    return this.db.meetingDraft.findFirst({
      where: { userId, status: 'awaiting_edit' },
      orderBy: { createdAt: 'desc' },
    });
  }
  findAwaitingEmail(userId: string) {
    return this.db.meetingDraft.findFirst({
      where: { userId, status: 'awaiting_email' },
      orderBy: { createdAt: 'desc' },
    });
  }
  getDraftRef(draftId: string) {
    return this.db.meetingDraft.findUnique({ where: { id: draftId } });
  }

  // ─── Run the graph to its next pause / terminal state, then emit ────
  private async run(
    draftId: string,
    userId: string,
    chatId: string,
    input: any,
  ) {
    const config = { configurable: { thread_id: draftId } };
    try {
      const result: Record<string, any> = await this.graph.invoke(
        input,
        config,
      );
      const intr = (result.__interrupt__ ?? [])[0] as
        | { value: SchedulerInterrupt }
        | undefined;

      if (intr?.value) {
        const payload = intr.value;
        const status =
          payload.kind === 'need_email' ? 'awaiting_email' : 'awaiting_approval';
        const summary =
          payload.kind === 'approve_meeting' ? payload.proposal.summary : '';
        await this.db.meetingDraft.update({
          where: { id: draftId },
          data: { status, summary },
        });
        this.events$.next({ kind: 'interrupt', userId, chatId, draftId, payload });
        return;
      }

      const status = (result.status as string) || 'cancelled';
      const proposal = result.proposal;
      let startLabel = '';
      if (proposal?.startISO) {
        const tz = await this.calendar.primaryTimeZone(userId);
        startLabel = this.calendar.formatDateTime(proposal.startISO, tz);
      }
      await this.db.meetingDraft.update({
        where: { id: draftId },
        data: { status, summary: proposal?.summary ?? '' },
      });
      this.events$.next({
        kind: 'done',
        userId,
        chatId,
        draftId,
        status,
        summary: proposal?.summary ?? '',
        startLabel,
        meetLink: result.meetLink ?? '',
        htmlLink: result.htmlLink ?? '',
      });
    } catch (err: any) {
      this.logger.error(`[draft ${draftId}] scheduler error: ${err.message}`);
      await this.db.meetingDraft
        .update({ where: { id: draftId }, data: { status: 'error' } })
        .catch(() => undefined);
      this.events$.next({
        kind: 'error',
        userId,
        chatId,
        draftId,
        message: err.message,
      });
    }
  }
}
