import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import {
  ApprovalCard,
  ApprovalCardFactory,
  ApprovalDecision,
} from './skill.types';

/** Emitted when a skill wants an approval card rendered to the user. */
export interface ApprovalRequestEvent {
  requestId: string;
  userId: string;
  card: ApprovalCard;
}

interface Pending {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A transport-agnostic HITL gate for NEW skills. A skill calls `request(...)`;
 * this emits an event a presenter (TelegramService) subscribes to, renders a
 * card, and later calls `resolve(requestId, decision)`. Built-in compose /
 * scheduler skills keep their own graphs — this is additive infrastructure for
 * MCP (Phase 2) and reminders (Phase 4). Nothing existing depends on it.
 */
@Injectable()
export class SkillApprovalService implements ApprovalCardFactory {
  private readonly logger = new Logger(SkillApprovalService.name);
  private readonly requests$ = new Subject<ApprovalRequestEvent>();
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  /** Presenters subscribe here to render cards. */
  get events$() {
    return this.requests$.asObservable();
  }

  private nextId(): string {
    this.seq += 1;
    return `apr-${this.seq}`;
  }

  request(userId: string, card: ApprovalCard): Promise<ApprovalDecision> {
    const requestId = this.nextId();
    const timeoutMs = Number(process.env.SKILL_APPROVAL_TIMEOUT_MS ?? 3600_000);
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.logger.warn(`approval ${requestId} expired`);
        resolve('expired');
      }, timeoutMs);
      // Node timers keep the event loop alive; approvals shouldn't.
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(requestId, { resolve, timer });
      this.requests$.next({ requestId, userId, card });
    });
  }

  /** Called by the presenter when the user taps a button. */
  resolve(requestId: string, decision: ApprovalDecision): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.resolve(decision);
    return true;
  }
}
