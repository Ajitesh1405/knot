import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';

export type FreeSlot = { start: string; end: string }; // ISO strings

export type Attendee = {
  email: string;
  name: string; // display name, or '' if Google didn't give one
  organizer: boolean;
  self: boolean; // is this the connected user?
  response: string; // accepted | declined | tentative | needsAction
};

export type Meeting = {
  id: string;
  title: string;
  startISO: string;
  start: Date | null; // null for all-day
  isAllDay: boolean;
  status: string;
  description: string; // the meeting agenda/notes
  location: string;
  hangoutLink: string;
  organizer: { email: string; name: string } | null;
  attendees: Attendee[];
};

export type CalRange = 'today' | 'tomorrow' | 'this_week';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(private readonly db: PrismaService) {}

  // Same OAuth pattern as GmailService — reuses the shared Google client.
  private buildOAuthClient(): OAuth2Client {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!,
    );
  }

  // Authenticated Calendar client — reuses the Gmail refresh token (same
  // Google account, calendar.readonly granted via incremental auth).
  private async clientFor(userId: string): Promise<calendar_v3.Calendar> {
    const s = await this.db.userSettings.findUnique({ where: { userId } });
    if (!s?.gmailRefreshToken) {
      throw new Error(
        'Calendar not connected. Use /connect_calendar to grant access.',
      );
    }
    const auth = this.buildOAuthClient();
    auth.setCredentials({ refresh_token: s.gmailRefreshToken });
    return google.calendar({ version: 'v3', auth });
  }

  // ─── The calendar's primary timezone (for day-boundary math) ────────
  async primaryTimeZone(userId: string): Promise<string> {
    try {
      const cal = await this.clientFor(userId);
      const r = await cal.calendars.get({ calendarId: 'primary' });
      return r.data.timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  // ─── Next N hours of meetings (used by "next meeting" + briefings) ──
  async listUpcoming(userId: string, hoursAhead = 24): Promise<Meeting[]> {
    const now = new Date();
    const max = new Date(now.getTime() + hoursAhead * 3600_000);
    return this.listBetween(userId, now.toISOString(), max.toISOString());
  }

  async nextMeeting(userId: string): Promise<Meeting | null> {
    const upcoming = await this.listUpcoming(userId, 24 * 14); // look 2 weeks
    const now = Date.now();
    // Skip meetings already underway — "next" means the next one to START.
    return upcoming.find((m) => m.start && m.start.getTime() > now) ?? null;
  }

  // ─── Meetings within a named range, in the user's timezone ──────────
  async listForRange(userId: string, range: CalRange): Promise<Meeting[]> {
    const tz = await this.primaryTimeZone(userId);
    const { timeMin, timeMax } = this.rangeBounds(tz, range);
    return this.listBetween(userId, timeMin, timeMax);
  }

  // ─── Core list: expands recurring → THIS instance, skips junk ───────
  async listBetween(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<Meeting[]> {
    const cal = await this.clientFor(userId);

    // Fan out over every visible calendar (events may live on a secondary
    // calendar, not just "primary").
    let calIds: string[];
    try {
      const r = await cal.calendarList.list({ maxResults: 100 });
      calIds = (r.data.items ?? [])
        .filter((c) => c.selected !== false) // calendars the user actually views
        .map((c) => c.id!)
        .filter(Boolean);
    } catch {
      calIds = [];
    }
    if (calIds.length === 0) calIds = ['primary'];

    const parsed: Meeting[] = [];
    for (const calId of calIds) {
      try {
        const res = await cal.events.list({
          calendarId: calId,
          timeMin,
          timeMax,
          singleEvents: true, // expand recurring into individual instances
          orderBy: 'startTime',
          maxResults: 50,
        });
        const raw = res.data.items ?? [];
        parsed.push(...raw.map((e) => this.parseEvent(e)));
      } catch (err: any) {
        this.logger.warn(`events.list failed for ${calId}: ${err.message}`);
      }
    }

    // Dedupe (same event can surface on multiple calendars), drop junk, sort.
    const seen = new Set<string>();
    const result = parsed
      .filter((m) => {
        if (m.id && seen.has(m.id)) return false;
        if (m.id) seen.add(m.id);
        return m.status !== 'cancelled' && !m.isAllDay;
      })
      .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));

    return result;
  }

  async getMeeting(userId: string, eventId: string): Promise<Meeting> {
    const cal = await this.clientFor(userId);
    const r = await cal.events.get({ calendarId: 'primary', eventId });
    return this.parseEvent(r.data);
  }

  // ─── Parse a Google event into our clean shape ──────────────────────
  private parseEvent(e: calendar_v3.Schema$Event): Meeting {
    const startDateTime = e.start?.dateTime ?? null;
    const isAllDay = !startDateTime && !!e.start?.date;
    const attendees: Attendee[] = (e.attendees ?? [])
      .filter((a) => !a.resource) // drop rooms / equipment
      .map((a) => ({
        email: a.email ?? '',
        name: a.displayName ?? '',
        organizer: !!a.organizer,
        self: !!a.self,
        response: a.responseStatus ?? 'needsAction',
      }));

    return {
      id: e.id ?? '',
      title: e.summary ?? '(no title)',
      startISO: startDateTime ?? e.start?.date ?? '',
      start: startDateTime ? new Date(startDateTime) : null,
      isAllDay,
      status: e.status ?? 'confirmed',
      description: e.description ?? '',
      location: e.location ?? '',
      hangoutLink: e.hangoutLink ?? '',
      organizer: e.organizer
        ? { email: e.organizer.email ?? '', name: e.organizer.displayName ?? '' }
        : null,
      attendees,
    };
  }

  // ─── Create an event (with Meet link + email invites) ───────────────
  async createEvent(
    userId: string,
    opts: {
      summary: string;
      description?: string;
      start: string | Date;
      end: string | Date;
      attendees: string[]; // email addresses
      withMeet?: boolean;
    },
  ): Promise<{ id: string; htmlLink: string; hangoutLink: string }> {
    const cal = await this.clientFor(userId);
    const tz = await this.primaryTimeZone(userId);
    const startISO =
      typeof opts.start === 'string' ? opts.start : opts.start.toISOString();
    const endISO =
      typeof opts.end === 'string' ? opts.end : opts.end.toISOString();

    const requestBody: calendar_v3.Schema$Event = {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: startISO, timeZone: tz },
      end: { dateTime: endISO, timeZone: tz },
      attendees: opts.attendees.map((email) => ({ email })),
    };
    if (opts.withMeet) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: `meet-${randomUUID()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const res = await cal.events.insert({
      calendarId: 'primary',
      requestBody,
      sendUpdates: 'all', // email the attendees
      conferenceDataVersion: opts.withMeet ? 1 : 0,
    });

    const hangoutLink =
      res.data.hangoutLink ??
      res.data.conferenceData?.entryPoints?.find(
        (e) => e.entryPointType === 'video',
      )?.uri ??
      '';
    this.logger.log(`created event ${res.data.id} for ${userId}`);
    return {
      id: res.data.id ?? '',
      htmlLink: res.data.htmlLink ?? '',
      hangoutLink,
    };
  }

  // ─── Find open slots that work for everyone (freebusy) ──────────────
  async findFreeSlots(
    userId: string,
    opts: {
      attendees: string[]; // email addresses (organizer's 'primary' is added)
      durationMins: number;
      windowStart?: string | Date;
      windowEnd?: string | Date;
      limit?: number;
    },
  ): Promise<FreeSlot[]> {
    const cal = await this.clientFor(userId);
    const tz = await this.primaryTimeZone(userId);
    const now = new Date();
    const timeMin = opts.windowStart ? new Date(opts.windowStart) : now;
    const timeMax = opts.windowEnd
      ? new Date(opts.windowEnd)
      : new Date(now.getTime() + 72 * 3600_000);

    const items = [
      { id: 'primary' },
      ...opts.attendees.map((email) => ({ id: email })),
    ];
    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: tz,
        items,
      },
    });

    // Collect every busy interval across all queried calendars.
    const busy: { start: number; end: number }[] = [];
    const cals = fb.data.calendars ?? {};
    for (const key of Object.keys(cals)) {
      for (const b of cals[key].busy ?? []) {
        busy.push({
          start: new Date(b.start!).getTime(),
          end: new Date(b.end!).getTime(),
        });
      }
    }

    const durMs = opts.durationMins * 60_000;
    const step = 30 * 60_000;
    const limit = opts.limit ?? 5;
    const overlaps = (s: number) =>
      busy.some((b) => s < b.end && b.start < s + durMs);

    // Walk candidate starts (rounded to :00/:30) within working hours (9–18).
    const lower = Math.max(now.getTime(), timeMin.getTime());
    let cursor = Math.ceil(lower / step) * step;
    const out: FreeSlot[] = [];
    let guard = 0;
    while (cursor + durMs <= timeMax.getTime() && out.length < limit) {
      if (guard++ > 1000) break; // safety
      const startHour = this.localHour(new Date(cursor), tz);
      const endHour = this.localHour(new Date(cursor + durMs - 1), tz);
      const inHours = startHour >= 9 && endHour < 18;
      if (inHours && !overlaps(cursor)) {
        out.push({
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + durMs).toISOString(),
        });
      }
      cursor += step;
    }
    return out;
  }

  private localHour(date: Date, tz: string): number {
    return parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        hour12: false,
      }).format(date),
      10,
    );
  }

  // ─── Format a meeting's start time in the user's timezone ───────────
  formatStart(m: Meeting, tz: string): string {
    if (!m.start) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(m.start);
  }

  // Format an ISO instant in the user's timezone, e.g. "Thu, Jun 5, 10:30 AM".
  formatDateTime(iso: string, tz: string): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  }

  // ─── Turn a fuzzy time hint into a freebusy search window ───────────
  // "tomorrow morning" → tomorrow 09:00–12:00 local, etc. Falls back to the
  // next 3 days when the hint is vague.
  buildWindow(tz: string, hint: string): { start: string; end: string } {
    const h = (hint ?? '').toLowerCase();
    const off = this.tzOffset(tz, new Date());
    const today = this.ymdInTz(new Date(), tz);
    const at = (ymd: string, hh: number) =>
      `${ymd}T${String(hh).padStart(2, '0')}:00:00${off}`;

    const startHr = h.includes('morning')
      ? 9
      : h.includes('afternoon')
        ? 12
        : h.includes('evening')
          ? 16
          : 9;
    const endHr = h.includes('morning')
      ? 12
      : h.includes('afternoon')
        ? 17
        : h.includes('evening')
          ? 20
          : 18;

    if (h.includes('today')) {
      return { start: new Date().toISOString(), end: at(today, endHr) };
    }
    if (h.includes('tomorrow')) {
      const t = this.addDays(today, 1);
      return { start: at(t, startHr), end: at(t, endHr) };
    }
    if (h.includes('week')) {
      return { start: new Date().toISOString(), end: at(this.addDays(today, 7), 18) };
    }
    // Vague hint → search the next 3 days.
    return { start: new Date().toISOString(), end: at(this.addDays(today, 3), 18) };
  }

  // ─── Timezone-aware day boundaries for today/tomorrow/this_week ─────
  private rangeBounds(tz: string, range: CalRange) {
    const today = this.ymdInTz(new Date(), tz);
    const off = this.tzOffset(tz, new Date());
    if (range === 'today') {
      return {
        timeMin: `${today}T00:00:00${off}`,
        timeMax: `${today}T23:59:59${off}`,
      };
    }
    if (range === 'tomorrow') {
      const t = this.addDays(today, 1);
      return {
        timeMin: `${t}T00:00:00${off}`,
        timeMax: `${t}T23:59:59${off}`,
      };
    }
    // this_week: from now through the next 7 days
    const end = this.addDays(today, 7);
    return {
      timeMin: new Date().toISOString(),
      timeMax: `${end}T23:59:59${off}`,
    };
  }

  // "2026-06-04" for the given instant in the given timezone.
  private ymdInTz(date: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  // Add N calendar days to a YYYY-MM-DD string.
  private addDays(ymd: string, n: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  // "+05:30" style offset for the timezone at the given instant.
  private tzOffset(tz: string, date: Date): string {
    const name =
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'longOffset',
      })
        .formatToParts(date)
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
    const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return '+00:00';
    return `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}`;
  }
}
