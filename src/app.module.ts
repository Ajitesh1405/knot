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
import { MobileModule } from './mobile/mobile.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/agent/{*splat}', '/mobile/{*splat}'],
    }),
    ScheduleModule.forRoot(), // enables @Cron (meeting briefings)
    PrismaModule, // ← global, available everywhere
    SettingsModule,
    AgentModule,
    GraphModule,
    TelegramModule,
    GmailModule,
    AuthModule,
    LlmModule,
    MobileModule,
  ],
})
export class AppModule {}
