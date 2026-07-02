import { Injectable, Logger } from '@nestjs/common';
import { GmailService, ParsedEmail } from '../gmail/gmail.service';
import { TriageSpecialist, TriageVerdict } from './triage.specialist';

export interface TriageCandidate {
  email: ParsedEmail;
  verdict: TriageVerdict;
}

export interface SweepResult {
  scanned: number; // new emails since watermark
  considered: number; // survived the cheap prefilter
  candidates: TriageCandidate[]; // triaged as needing a reply
}

// Senders that never warrant a personal reply.
const AUTOMATED_FROM =
  /(no[-.]?reply|do[-.]?not[-.]?reply|donotreply|notifications?@|mailer-daemon|postmaster@|automated|@.*\.mailchimp|bounce)/i;

// Gmail categories that are never "primary personal" mail.
const BULK_LABELS = new Set([
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
  'SPAM',
]);

@Injectable()
export class ProactiveService {
  private readonly logger = new Logger(ProactiveService.name);

  constructor(
    private readonly gmail: GmailService,
    private readonly triage: TriageSpecialist,
  ) {}

  // Fetch new mail, prefilter cheaply, triage the survivors, advance the
  // watermark. Returns the reply-worthy candidates (Phase 1: caller logs them).
  async sweepUser(userId: string): Promise<SweepResult> {
    const self = await this.gmail.getProfileEmail(userId).catch(() => '');
    const { emails, newestId } = await this.gmail.fetchNewSince(userId);

    const considered = emails.filter((e) => this.shouldConsider(e, self));

    const candidates: TriageCandidate[] = [];
    for (const email of considered) {
      const verdict = await this.triage.classify(email);
      if (verdict.needsReply) candidates.push({ email, verdict });
    }

    // Advance the watermark AFTER processing so a crash mid-sweep re-tries.
    if (newestId) await this.gmail.setWatermark(userId, newestId);

    return {
      scanned: emails.length,
      considered: considered.length,
      candidates,
    };
  }

  // ─── Cheap, deterministic prefilter — runs before any LLM call ──────
  private shouldConsider(email: ParsedEmail, self: string): boolean {
    // Bulk / non-primary categories.
    if (email.labelIds.some((l) => BULK_LABELS.has(l))) return false;
    // Newsletters / mass mail advertise an unsubscribe link.
    if (email.listUnsubscribe) return false;
    // Automated senders.
    const fromAddr = this.gmail.addressOf(email.from).toLowerCase();
    if (AUTOMATED_FROM.test(email.from) || AUTOMATED_FROM.test(fromAddr)) {
      return false;
    }
    // Don't reply to yourself.
    if (self && fromAddr === self) return false;
    // Must be addressed to the user directly (in To), not Cc-only or bulk.
    if (self) {
      const inTo = email.to.toLowerCase().includes(self);
      if (!inTo) return false;
    }
    return true;
  }
}
