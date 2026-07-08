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

  async disconnectGmail(userId: string) {
    // updateMany → no-op (not a 500) if the user has no settings row yet.
    return this.db.userSettings.updateMany({
      where: { userId },
      data: { gmailRefreshToken: null },
    });
  }

  // ─── Per-user skill enable/disable ──────────────────────────────
  // Absence of a row means "enabled" (the default), so the set returned
  // here is only the skills a user has explicitly turned OFF.
  async disabledSkills(userId: string): Promise<Set<string>> {
    const rows = await this.db.skillSetting.findMany({
      where: { userId, enabled: false },
      select: { skill: true },
    });
    return new Set(rows.map((r) => r.skill));
  }

  async isSkillEnabled(userId: string, skill: string): Promise<boolean> {
    const row = await this.db.skillSetting.findUnique({
      where: { userId_skill: { userId, skill } },
    });
    return row?.enabled ?? true;
  }

  async setSkillEnabled(userId: string, skill: string, enabled: boolean) {
    return this.db.skillSetting.upsert({
      where: { userId_skill: { userId, skill } },
      update: { enabled },
      create: { userId, skill, enabled },
    });
  }
}
