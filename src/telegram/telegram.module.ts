import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { AgentModule } from '../agent/agent.module';
import { SettingsModule } from '../settings/settings.module'; // ← NEW
import { GmailModule } from '../gmail/gmail.module';
import { OutlookModule } from '../outlook/outlook.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    AgentModule,
    SettingsModule,
    GmailModule,
    OutlookModule,
    CalendarModule,
  ],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
