import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  UseGuards,
} from '@nestjs/common';
import { GmailService } from '../gmail/gmail.service';
import { OutlookService } from '../outlook/outlook.service';
import { SettingsService } from '../settings/settings.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// ─────────────────────────────────────────────────────────────────
// Linking external accounts from the mobile app:
//   1. GET  .../connect-url  → returns the provider consent URL
//   2. app opens it in a browser/webview; user consents
//   3. provider redirects to /auth/{google,microsoft}/callback,
//      which stores the tokens for this userId
//   4. app polls GET /api/integrations to see it's connected
// ─────────────────────────────────────────────────────────────────
@UseGuards(JwtAuthGuard)
@Controller('api/integrations')
export class IntegrationsApiController {
  constructor(
    private readonly gmail: GmailService,
    private readonly outlook: OutlookService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async status(@CurrentUser('userId') userId: string) {
    const s = await this.settings.get(userId);
    return {
      google: { connected: !!s.gmailRefreshToken },
      microsoft: {
        connected: !!s.outlookRefreshToken,
        configured: !!process.env.MS_CLIENT_ID,
      },
    };
  }

  @Get('google/connect-url')
  googleConnectUrl(@CurrentUser('userId') userId: string) {
    return { url: this.gmail.getAuthUrl(userId) };
  }

  @Get('microsoft/connect-url')
  microsoftConnectUrl(@CurrentUser('userId') userId: string) {
    if (!process.env.MS_CLIENT_ID) {
      throw new BadRequestException('Outlook integration is not configured');
    }
    return { url: this.outlook.getAuthUrl(userId) };
  }

  @Delete('google')
  async disconnectGoogle(@CurrentUser('userId') userId: string) {
    await this.settings.disconnectGmail(userId);
    return { ok: true };
  }

  @Delete('microsoft')
  async disconnectMicrosoft(@CurrentUser('userId') userId: string) {
    await this.outlook.disconnect(userId);
    return { ok: true };
  }
}
