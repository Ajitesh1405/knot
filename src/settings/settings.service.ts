import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type Scope = 'personal' | 'everything';
export type EmailRange = 'new_only' | 'last_30_days' | 'last_year' | 'all';

@Injectable()
export class SettingsService {
  constructor(private readonly db: PrismaService) {}

  // Get settings or create defaults if user doesn't exist yet
  async get(userId: string) {
    return this.db.userSettings.upsert({
      where: { userId },
      update: {}, // no change if exists
      create: { userId }, // default scope + range
    });
  }

  async setScope(userId: string, scope: Scope) {
    return this.db.userSettings.upsert({
      where: { userId },
      update: { scope },
      create: { userId, scope },
    });
  }

  async setRange(userId: string, emailRange: EmailRange) {
    return this.db.userSettings.upsert({
      where: { userId },
      update: { emailRange },
      create: { userId, emailRange },
    });
  }
  async setBriefings(userId: string, enabled: boolean) {
    return this.db.userSettings.upsert({
      where: { userId },
      update: { briefingsEnabled: enabled },
      create: { userId, briefingsEnabled: enabled },
    });
  }

  async setAutoDraft(userId: string, enabled: boolean) {
    return this.db.userSettings.upsert({
      where: { userId },
      update: { autoDraftEnabled: enabled },
      create: { userId, autoDraftEnabled: enabled },
    });
  }

  async disconnectGmail(userId: string) {
    return this.db.userSettings.update({
      where: { userId },
      data: { gmailRefreshToken: null },
    });
  }
}
