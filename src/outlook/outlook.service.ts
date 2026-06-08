import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Microsoft identity platform (v2.0) + Graph — manual OAuth2, no MSAL dep.
const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['offline_access', 'User.Read', 'Mail.Read'];

export type OutlookEmail = {
  id: string;
  from: string; // "Name <addr>"
  subject: string;
  snippet: string;
  body: string;
  date: string;
};

@Injectable()
export class OutlookService {
  private readonly logger = new Logger(OutlookService.name);

  constructor(private readonly db: PrismaService) {}

  // ─── Step 1: consent URL ────────────────────────────────────────────
  getAuthUrl(userId: string): string {
    const params = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: process.env.MS_REDIRECT_URI!,
      response_mode: 'query',
      scope: SCOPES.join(' '),
      state: userId,
      prompt: 'select_account',
    });
    return `${AUTH_BASE}/authorize?${params.toString()}`;
  }

  // ─── Step 2: exchange code → store refresh token ────────────────────
  async handleCallback(code: string, userId: string): Promise<void> {
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.MS_REDIRECT_URI!,
    });
    if (!tokens.refresh_token) {
      throw new Error('No refresh token returned from Microsoft.');
    }
    await this.db.userSettings.upsert({
      where: { userId },
      update: { outlookRefreshToken: tokens.refresh_token },
      create: { userId, outlookRefreshToken: tokens.refresh_token },
    });
  }

  // ─── Fetch recent messages ──────────────────────────────────────────
  async fetchRecent(
    userId: string,
    limit = 10,
    timeRange = 'today',
  ): Promise<OutlookEmail[]> {
    const access = await this.accessTokenFor(userId);

    const params = new URLSearchParams({
      $top: String(limit),
      $select: 'id,subject,from,bodyPreview,body,receivedDateTime',
      $orderby: 'receivedDateTime desc',
    });
    const since = this.sinceFilter(timeRange);
    if (since) params.set('$filter', `receivedDateTime ge ${since}`);

    const res = await fetch(`${GRAPH}/me/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!res.ok) {
      throw new Error(`Graph error ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    return (data.value ?? []).map((m: any) => this.parse(m));
  }

  // ─── Helpers ────────────────────────────────────────────────────────
  private parse(m: any): OutlookEmail {
    const addr = m.from?.emailAddress;
    const from = addr
      ? `${addr.name ?? ''} <${addr.address ?? ''}>`.trim()
      : '';
    const html = m.body?.contentType === 'html';
    const bodyText = html
      ? (m.body?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      : (m.body?.content ?? '');
    return {
      id: m.id,
      from,
      subject: m.subject ?? '',
      snippet: m.bodyPreview ?? '',
      body: bodyText.trim(),
      date: m.receivedDateTime ?? '',
    };
  }

  private sinceFilter(timeRange: string): string | null {
    const now = Date.now();
    if (timeRange === 'today') return new Date(now - 24 * 3600_000).toISOString();
    if (timeRange === 'this_week')
      return new Date(now - 7 * 24 * 3600_000).toISOString();
    return null; // 'all'
  }

  // Refresh the access token from the stored refresh token.
  private async accessTokenFor(userId: string): Promise<string> {
    const s = await this.db.userSettings.findUnique({ where: { userId } });
    if (!s?.outlookRefreshToken) {
      throw new Error('Outlook not connected. Use /connect_outlook.');
    }
    const tokens = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: s.outlookRefreshToken,
    });
    // Microsoft rotates refresh tokens — persist the new one if present.
    if (tokens.refresh_token && tokens.refresh_token !== s.outlookRefreshToken) {
      await this.db.userSettings.update({
        where: { userId },
        data: { outlookRefreshToken: tokens.refresh_token },
      });
    }
    return tokens.access_token;
  }

  private async tokenRequest(
    extra: Record<string, string>,
  ): Promise<{ access_token: string; refresh_token?: string }> {
    const body = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: SCOPES.join(' '),
      ...extra,
    });
    const res = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Token request failed ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<{ access_token: string; refresh_token?: string }>;
  }

  async disconnect(userId: string): Promise<void> {
    await this.db.userSettings.update({
      where: { userId },
      data: { outlookRefreshToken: null },
    });
  }
}
