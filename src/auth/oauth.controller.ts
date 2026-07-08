import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GmailService } from '../gmail/gmail.service';
import { OutlookService } from '../outlook/outlook.service';

// ─────────────────────────────────────────────────────────────────
// Provider OAuth (linking a user's Gmail / Outlook account). This is
// NOT app login — see auth.controller.ts for user authentication.
// `state` carries the app userId so the callback knows whose tokens
// these are. Google/Microsoft redirect the browser back here, so
// these routes stay public (no JWT) and are keyed by `state`.
// ─────────────────────────────────────────────────────────────────

@Controller('auth/google')
export class GoogleOAuthController {
  constructor(private readonly gmail: GmailService) {}

  // Step 1: user visits /auth/google?userId=usr-… → redirected to Google
  @Get()
  start(@Query('userId') userId: string, @Res() res: Response) {
    if (!userId) {
      res.status(400).send('Missing userId query param');
      return;
    }
    const url = this.gmail.getAuthUrl(userId);
    res.redirect(url);
  }

  // Step 2: Google sends user back here with ?code=...&state=userId
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    try {
      await this.gmail.handleCallback(code, userId);
      res.send(
        `<h2>✓ Gmail connected</h2>` +
          `<p>You can close this tab and return to the app.</p>`,
      );
    } catch (err: any) {
      res.status(500).send(`Error: ${err.message}`);
    }
  }
}

@Controller('auth/microsoft')
export class MicrosoftOAuthController {
  constructor(private readonly outlook: OutlookService) {}

  @Get()
  start(@Query('userId') userId: string, @Res() res: Response) {
    if (!userId) {
      res.status(400).send('Missing userId query param');
      return;
    }
    res.redirect(this.outlook.getAuthUrl(userId));
  }

  // Microsoft sends the user back here with ?code=...&state=userId
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    try {
      await this.outlook.handleCallback(code, userId);
      res.send(
        `<h2>✓ Outlook connected</h2>` +
          `<p>You can close this tab and return to the app.</p>`,
      );
    } catch (err: any) {
      res.status(500).send(`Error: ${err.message}`);
    }
  }
}
