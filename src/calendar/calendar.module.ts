import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { BriefingService } from './briefing.service';
import { BriefingScheduler } from './briefing.scheduler';
import { CronController } from './cron.controller';
import { GraphModule } from '../graph/graph.module';
import { GmailModule } from '../gmail/gmail.module';

@Module({
  imports: [GraphModule, GmailModule],
  controllers: [CronController],
  providers: [CalendarService, BriefingService, BriefingScheduler],
  exports: [CalendarService, BriefingService, BriefingScheduler],
})
export class CalendarModule {}
