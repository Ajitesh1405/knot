import {
  Controller,
  Get,
  Headers,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { BriefingScheduler } from './briefing.scheduler';

// Vercel Cron entrypoint for the meeting-briefing sweep. On serverless the
// in-process @Cron never fires (no long-lived process), so Vercel Cron calls
// this endpoint on a schedule instead (see vercel.json). Vercel automatically
// sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
@Controller('cron')
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(private readonly briefingScheduler: BriefingScheduler) {}

  @Get('briefing')
  async briefing(
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    const secret = process.env.CRON_SECRET;
    if (secret && auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Bad cron secret');
    }
    this.logger.log('Running briefing sweep (Vercel Cron)');
    await this.briefingScheduler.tick();
    return { ok: true };
  }
}
