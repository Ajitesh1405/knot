import { Injectable } from '@nestjs/common';
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GmailService {
  constructor(private readonly db: PrismaService) {}

  // ─── Build a fresh OAuth client (stateless — safe to create per call) ─
  private buildOAuthClient(): OAuth2Client {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!,
    );
  }

  // ─── Step 1: generate the "click here to connect" URL ───────────────
  getAuthUrl(userId: string): string {
    const client = this.buildOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline', // gives us refresh token
      // 'select_account' forces Google's account chooser (so you can switch
      // between Google accounts); 'consent' ensures a fresh refresh token.
      prompt: 'select_account consent',
      include_granted_scopes: true, // incremental auth — merge with prior grants
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar.readonly', // Phase 7
        'https://www.googleapis.com/auth/calendar.events', // Phase 7B (write)
      ],
      state: userId, // bind THIS oauth flow to THIS user
    });
  }

  // ─── Step 2: exchange the code Google sent back for tokens ──────────
  async handleCallback(code: string, userId: string): Promise<void> {
    const client = this.buildOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh token returned. Revoke access at https://myaccount.google.com/permissions and retry.',
      );
    }

    // Save refresh token in UserSettings (per-user)
    await this.db.userSettings.upsert({
      where: { userId },
      update: { gmailRefreshToken: tokens.refresh_token },
      create: { userId, gmailRefreshToken: tokens.refresh_token },
    });
  }

  // ─── Get an authenticated Gmail client for a user ───────────────────
  private async clientFor(userId: string): Promise<gmail_v1.Gmail> {
    const settings = await this.db.userSettings.findUnique({
      where: { userId },
    });
    if (!settings?.gmailRefreshToken) {
      throw new Error('Gmail not connected. Visit /auth/google to connect.');
    }

    const auth = this.buildOAuthClient();
    auth.setCredentials({ refresh_token: settings.gmailRefreshToken });
    // The library auto-refreshes the access token when needed
    return google.gmail({ version: 'v1', auth });
  }

  // ─── Fetch recent emails ────────────────────────────────────────────
  async fetchRecent(userId: string, limit = 10, timeRange = 'today') {
    const gmail = await this.clientFor(userId);

    // Build the Gmail query string based on the time range
    let q = 'in:inbox category:primary';
    if (timeRange === 'today') q += ' newer_than:1d';
    if (timeRange === 'this_week') q += ' newer_than:7d';
    // 'all' = no date filter

    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults: limit,
      q,
    });

    const messageIds = list.data.messages ?? [];

    // Fetch full content for each
    const emails = await Promise.all(
      messageIds.map(async (m) => {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id: m.id!,
          format: 'full',
        });
        return this.parseEmail(full.data);
      }),
    );

    return emails;
  }

  // ─── Parse a Gmail message into a clean shape ───────────────────────
  private parseEmail(msg: gmail_v1.Schema$Message) {
    const headers = msg.payload?.headers ?? [];
    const get = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? '';

    return {
      id: msg.id!,
      threadId: msg.threadId ?? '',
      messageId: get('Message-ID'), // RFC 2822 header — needed for In-Reply-To
      from: get('From'),
      to: get('To'),
      subject: get('Subject'),
      date: get('Date'),
      snippet: msg.snippet ?? '',
      body: this.extractBody(msg.payload),
    };
  }

  // ─── Find distinct senders matching a name/address ──────────────────
  // Resolves "reply to Sarah" → one parsed email per DISTINCT sender
  // (the most recent from each). Caller decides what to do when >1:
  // a single match drafts straight away, multiple → ask the user which.
  async findCandidateSenders(userId: string, nameOrEmail: string, max = 5) {
    const gmail = await this.clientFor(userId);
    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10, // scan a few, then dedupe down to distinct senders
      q: `from:(${nameOrEmail})`,
    });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    if (ids.length === 0) return [];

    const parsed = await Promise.all(
      ids.map(async (id) => {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        });
        return this.parseEmail(full.data);
      }),
    );

    // Dedupe by sender address (keep first = most recent, list is newest-first).
    const seen = new Set<string>();
    const distinct: typeof parsed = [];
    for (const e of parsed) {
      const addr = this.addressOf(e.from).toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      distinct.push(e);
      if (distinct.length >= max) break;
    }
    return distinct;
  }

  // Extract the bare email address from a "Name <addr@x>" header.
  addressOf(fromHeader: string): string {
    const m = fromHeader.match(/<([^>]+)>/);
    return (m ? m[1] : fromHeader).trim();
  }

  // ─── Send an email (optionally as a reply within a thread) ──────────
  async send(
    userId: string,
    opts: {
      to: string;
      subject: string;
      body: string;
      threadId?: string; // reply within this thread
      inReplyTo?: string; // original Message-ID for proper threading
    },
  ): Promise<{ id: string; threadId: string }> {
    const gmail = await this.clientFor(userId);

    // Build a minimal RFC 2822 message.
    const headers = [
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
    ];
    if (opts.inReplyTo) {
      headers.push(`In-Reply-To: ${opts.inReplyTo}`);
      headers.push(`References: ${opts.inReplyTo}`);
    }
    const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${opts.body}`)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''); // base64url, per Gmail API

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: opts.threadId },
    });
    return { id: res.data.id!, threadId: res.data.threadId! };
  }

  // ─── Walk Gmail's nested MIME structure to extract plain text ───────
  private extractBody(payload?: gmail_v1.Schema$MessagePart): string {
    if (!payload) return '';

    // Single-part: just decode the body
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // Multi-part: prefer text/plain, fall back to text/html
    if (payload.parts) {
      const plain = payload.parts.find((p) => p.mimeType === 'text/plain');
      if (plain?.body?.data) {
        return Buffer.from(plain.body.data, 'base64').toString('utf-8');
      }
      // Recurse for nested multipart
      for (const part of payload.parts) {
        const body = this.extractBody(part);
        if (body) return body;
      }
    }

    return '';
  }
}
