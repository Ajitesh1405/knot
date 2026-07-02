import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { GmailModule } from '../gmail/gmail.module';
import { SettingsModule } from '../settings/settings.module';
import { MobileController } from './mobile.controller';
import { MobileUserService } from './mobile-user.service';
import { MobileAuthGuard } from './mobile-auth.guard';

// Telegram-independent REST API for the mobile app.
// AgentModule exports AgentService / ComposeHitlService / CalendarSpecialist;
// PrismaService is @Global.
@Module({
  imports: [AgentModule, GmailModule, SettingsModule],
  controllers: [MobileController],
  providers: [MobileUserService, MobileAuthGuard],
  exports: [MobileUserService],
})
export class MobileModule {}
