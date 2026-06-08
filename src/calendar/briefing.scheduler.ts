import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService, Meeting } from './calendar.service';
import { BriefingService } from './briefing.service';

// Meetings starting in this window get a heads-up. The 5-min cron + 10-min
// window means a meeting can match a couple of runs; MeetingBriefing dedupes.
const LEAD_MIN = 25;
const LEAD_MAX = 35;

@Injectable()
export class BriefingScheduler {
  private readonly logger = new Logger(BriefingScheduler.name);

  // Telegram subscribes to push the briefing to the right chat.
  readonly briefing$ = new Subject<{ userId: string; text: string }>();

  constructor(
    private readonly db: PrismaService,
    private readonly calendar: CalendarService,
    private readonly briefing: BriefingService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    let users: { userId: string }[];
    try {
      users = await this.db.userSettings.findMany({
        where: { briefingsEnabled: true, gmailRefreshToken: { not: null } },
        select: { userId: true },
      });
    } catch (err: any) {
      this.logger.error(`briefing sweep failed: ${err.message}`);
      return;
    }
    for (const { userId } of users) {
      await this.briefUser(userId).catch((err) =>
        this.logger.warn(`[${userId}] briefing failed: ${err.message}`),
      );
    }
  }

  // ─── Brief any meeting starting ~30 min out, once ───────────────────
  private async briefUser(userId: string) {
    const soon = await this.startingSoon(userId);
    for (const m of soon) {
      // Dedupe: skip if we've already briefed this event.
      const already = await this.db.meetingBriefing.findUnique({
        where: { userId_eventId: { userId, eventId: m.id } },
      });
      if (already) continue;

      const text = await this.briefing.build(userId, m);
      this.briefing$.next({ userId, text });
      await this.db.meetingBriefing.create({
        data: { userId, eventId: m.id },
      });
      this.logger.log(`[${userId}] briefed "${m.title}"`);
    }
  }

  // Meetings whose START falls within the [LEAD_MIN, LEAD_MAX] window.
  private async startingSoon(userId: string): Promise<Meeting[]> {
    const now = Date.now();
    const meetings = await this.calendar.listBetween(
      userId,
      new Date(now).toISOString(),
      new Date(now + (LEAD_MAX + 5) * 60_000).toISOString(),
    );
    return meetings.filter(
      (m) =>
        m.start &&
        m.start.getTime() >= now + LEAD_MIN * 60_000 &&
        m.start.getTime() <= now + LEAD_MAX * 60_000,
    );
  }
}
