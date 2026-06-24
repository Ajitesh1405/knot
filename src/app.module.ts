import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import { AgentModule } from './agent/agent.module';
import { GraphModule } from './graph/graph.module';
import { TelegramModule } from './telegram/telegram.module';
import { PrismaModule } from './prisma/prisma.module'; // ← NEW
import { SettingsModule } from './settings/settings.module'; // ← NEW
import { GmailModule } from './gmail/gmail.module';
import { AuthModule } from './auth/auth.module';
import { LlmModule } from './llm/llm.module';
import { RemindersModule } from './reminders/reminders.module';
import { CommitmentsModule } from './commitments/commitments.module';
import { DigestModule } from './digest/digest.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MobileModule } from './mobile/mobile.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/agent/{*splat}', '/api/{*splat}', '/auth/{*splat}'],
    }),
    ScheduleModule.forRoot(), // enables @Cron (briefings, reminders, digest, nudges)
    PrismaModule, // ← global, available everywhere
    SettingsModule,
    AgentModule,
    GraphModule,
    TelegramModule,
    GmailModule,
    AuthModule,
    LlmModule,
    RemindersModule,
    CommitmentsModule,
    DigestModule,
    NotificationsModule,
    MobileModule,
  ],
})
export class AppModule {}
