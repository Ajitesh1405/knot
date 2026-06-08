import { Injectable, Logger } from '@nestjs/common';
import { CalendarService, Meeting } from './calendar.service';
import { GraphService } from '../graph/graph.service';
import { GmailService } from '../gmail/gmail.service';

@Injectable()
export class BriefingService {
  private readonly logger = new Logger(BriefingService.name);

  constructor(
    private readonly calendar: CalendarService,
    private readonly graph: GraphService,
    private readonly gmail: GmailService,
  ) {}

  // ─── Brief every meeting still upcoming today (fallback: next one) ──
  // Shared by the /next meeting command and natural-language requests.
  async briefUpcoming(userId: string): Promise<string> {
    const now = Date.now();
    const todays = await this.calendar.listForRange(userId, 'today');
    let upcoming = todays.filter((m) => m.start && m.start.getTime() > now);
    if (upcoming.length === 0) {
      const next = await this.calendar.nextMeeting(userId);
      upcoming = next ? [next] : [];
    }
    if (upcoming.length === 0) return 'No upcoming meetings. 🎉';
    const briefs = await Promise.all(
      upcoming.slice(0, 5).map((m) => this.build(userId, m)),
    );
    return briefs.join('\n\n────────\n\n');
  }

  // ─── Build a short, mobile-readable briefing for one meeting ────────
  async build(userId: string, m: Meeting): Promise<string> {
    const tz = await this.calendar.primaryTimeZone(userId);
    const others = m.attendees.filter((a) => !a.self);

    const lines: string[] = [];

    // Header — "in X min" when imminent, else the formatted start time.
    const mins = m.start
      ? Math.round((m.start.getTime() - Date.now()) / 60000)
      : null;
    const when =
      mins !== null && mins >= 0 && mins <= 180
        ? `in ${mins} min`
        : this.calendar.formatStart(m, tz);
    lines.push(`📅 Meeting${when ? ` ${when}` : ''}: ${m.title}`);

    // Attendees (display names, falling back to email; cap the list).
    if (others.length) {
      const names = others
        .slice(0, 6)
        .map((a) => a.name || a.email || 'someone');
      lines.push(`👥 ${names.join(', ')}${others.length > 6 ? ' …' : ''}`);
    }

    // Agenda (the event description), collapsed to a single short line.
    if (m.description) {
      const agenda = m.description.replace(/\s+/g, ' ').trim().slice(0, 240);
      if (agenda) lines.push(`📝 ${agenda}`);
    }

    // Per-attendee graph context (cap to keep it short).
    const contextBits: string[] = [];
    const commitments: string[] = [];
    for (const a of others.slice(0, 3)) {
      const aliases = this.aliasesFor(a.name, a.email);
      if (aliases.length === 0) continue;
      try {
        const facts = await this.graph.getFactsAbout(userId, aliases);
        if (facts && !facts.startsWith('(')) {
          // Drop the echo of THIS meeting's own ATTENDS/ORGANIZED_BY edges.
          const useful = facts
            .split('\n')
            .filter((f) => !f.toLowerCase().includes(m.title.toLowerCase()));
          if (useful.length) contextBits.push(useful[0]);
          // Open commitments = REQUESTED relations we know about.
          for (const f of useful) {
            if (/request/i.test(f)) commitments.push(f);
          }
        }
      } catch (err: any) {
        this.logger.warn(`context lookup failed: ${err.message}`);
      }
    }
    if (contextBits.length) lines.push(`🧠 ${contextBits.join(' · ')}`);

    // Recent emails from any attendee (latest subject each, up to 3).
    const recent: string[] = [];
    for (const a of others) {
      if (!a.email || recent.length >= 3) continue;
      try {
        const [latest] = await this.gmail.findCandidateSenders(
          userId,
          a.email,
          1,
        );
        // Skip calendar invites / responses and the invite for this meeting.
        const subj = latest?.subject ?? '';
        const isInvite =
          /^(invitation|invitation from|accepted|declined|tentative|updated invitation|canceled event)/i.test(
            subj,
          ) || subj.toLowerCase().includes(m.title.toLowerCase());
        if (subj && !isInvite) {
          recent.push(`${a.name || a.email}: "${subj}"`);
        }
      } catch (err: any) {
        this.logger.warn(`recent-email lookup failed: ${err.message}`);
      }
    }
    if (recent.length) lines.push(`📧 ${recent.join('; ')}`);

    if (commitments.length) {
      lines.push(`🎯 ${[...new Set(commitments)].slice(0, 3).join('; ')}`);
    }

    return lines.join('\n');
  }

  // Name forms so "Sarah Mehta" / "sarah.mehta@x" resolve to one graph node.
  private aliasesFor(name: string, email: string): string[] {
    const out: string[] = [];
    if (name) {
      out.push(name, name.split(/\s+/)[0]);
    }
    if (email) {
      const local = email.split('@')[0];
      out.push(local, local.replace(/[._-]+/g, ' '));
    }
    return [...new Set(out.filter((s) => s && s.length >= 3))];
  }
}
