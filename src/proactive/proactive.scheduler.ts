import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ProactiveService } from './proactive.service';

@Injectable()
export class ProactiveScheduler {
  private readonly logger = new Logger(ProactiveScheduler.name);

  constructor(
    private readonly db: PrismaService,
    private readonly proactive: ProactiveService,
  ) {}

  // Hourly sweep. Phase 1 is a DRY RUN: we triage and LOG reply-worthy mail
  // but do NOT draft or notify yet — this lets us validate triage quality on
  // real inboxes before anything reaches the user.
  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    let users: { userId: string }[];
    try {
      users = await this.db.userSettings.findMany({
        where: { autoDraftEnabled: true, gmailRefreshToken: { not: null } },
        select: { userId: true },
      });
    } catch (err: any) {
      this.logger.error(`auto-draft sweep failed: ${err.message}`);
      return;
    }
    if (users.length === 0) return;

    this.logger.log(`auto-draft sweep: ${users.length} user(s)`);
    for (const { userId } of users) {
      await this.sweepUser(userId).catch((err) =>
        this.logger.warn(`[${userId}] auto-draft sweep failed: ${err.message}`),
      );
    }
  }

  private async sweepUser(userId: string) {
    const { scanned, considered, candidates } =
      await this.proactive.sweepUser(userId);
    this.logger.log(
      `[${userId}] scanned=${scanned} considered=${considered} ` +
        `needsReply=${candidates.length}`,
    );
    for (const { email, verdict } of candidates) {
      // DRY RUN — Phase 2 will draft + push an approval card here.
      this.logger.log(
        `[${userId}] WOULD DRAFT → from="${email.from}" ` +
          `subj="${email.subject}" importance=${verdict.importance} ` +
          `reason="${verdict.reason}"`,
      );
    }
  }
}
