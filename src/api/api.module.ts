import { Module } from '@nestjs/common';
import { AgentApiController } from './agent-api.controller';
import { SettingsApiController } from './settings-api.controller';
import { IntegrationsApiController } from './integrations-api.controller';
import { AuthModule } from '../auth/auth.module';
import { AgentModule } from '../agent/agent.module';
import { SettingsModule } from '../settings/settings.module';
import { GmailModule } from '../gmail/gmail.module';
import { OutlookModule } from '../outlook/outlook.module';

// The mobile/web REST surface: everything under /api/* (except the
// auth routes in AuthModule). All controllers here sit behind
// JwtAuthGuard and derive the user from the token.
@Module({
  imports: [
    AuthModule, // JwtAuthGuard + AuthService
    AgentModule, // AgentService, ComposeHitlService, CalendarSpecialist
    SettingsModule,
    GmailModule,
    OutlookModule,
  ],
  controllers: [
    AgentApiController,
    SettingsApiController,
    IntegrationsApiController,
  ],
})
export class ApiModule {}
