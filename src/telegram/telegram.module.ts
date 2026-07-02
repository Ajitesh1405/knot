import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AgentModule } from '../agent/agent.module';
import { SettingsModule } from '../settings/settings.module'; // ← NEW
import { GmailModule } from '../gmail/gmail.module';
import { OutlookModule } from '../outlook/outlook.module';
import { CalendarModule } from '../calendar/calendar.module';
import { MobileModule } from '../mobile/mobile.module';

@Module({
  imports: [
    AgentModule,
    SettingsModule,
    GmailModule,
    OutlookModule,
    CalendarModule,
    MobileModule,
  ],
  providers: [TelegramService],
})
export class TelegramModule {}
