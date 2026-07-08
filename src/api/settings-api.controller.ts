import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { parseBody, settingsSchema } from '../auth/validation';

// Never expose the stored OAuth refresh tokens to the client.
function publicSettings(s: {
  scope: string;
  emailRange: string;
  briefingsEnabled: boolean;
  gmailRefreshToken: string | null;
  outlookRefreshToken: string | null;
  updatedAt: Date;
}) {
  return {
    scope: s.scope,
    emailRange: s.emailRange,
    briefingsEnabled: s.briefingsEnabled,
    gmailConnected: !!s.gmailRefreshToken,
    outlookConnected: !!s.outlookRefreshToken,
    updatedAt: s.updatedAt,
  };
}

@UseGuards(JwtAuthGuard)
@Controller('api/settings')
export class SettingsApiController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get(@CurrentUser('userId') userId: string) {
    return publicSettings(await this.settings.get(userId));
  }

  @Patch()
  async update(@CurrentUser('userId') userId: string, @Body() body: unknown) {
    const { scope, emailRange, briefingsEnabled } = parseBody(
      settingsSchema,
      body,
    );
    if (scope) await this.settings.setScope(userId, scope);
    if (emailRange) await this.settings.setRange(userId, emailRange);
    if (briefingsEnabled !== undefined) {
      await this.settings.setBriefings(userId, briefingsEnabled);
    }
    return publicSettings(await this.settings.get(userId));
  }
}
