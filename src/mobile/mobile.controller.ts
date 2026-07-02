import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { ComposeHitlService, HitlOutcome } from '../agent/compose-hitl.service';
import { CalendarSpecialist } from '../agent/calendar.specialist';
import { GmailService } from '../gmail/gmail.service';
import { SettingsService, Scope, EmailRange } from '../settings/settings.service';
import { MobileUserService } from './mobile-user.service';
import { MobileAuthGuard } from './mobile-auth.guard';
import type { MobileRequest } from './mobile-auth.guard';

type EmailRangeParam = 'today' | 'this_week' | 'all';
type MeetingRangeParam = 'today' | 'tomorrow' | 'this_week';

@Controller('mobile')
export class MobileController {
  constructor(
    private readonly users: MobileUserService,
    private readonly agent: AgentService,
    private readonly hitl: ComposeHitlService,
    private readonly calendarSpec: CalendarSpecialist,
    private readonly gmail: GmailService,
    private readonly settings: SettingsService,
  ) {}

  // ─── Auth ───────────────────────────────────────────────────────────
  // Exchange a Telegram /pair code for a long-lived bearer token.
  @Post('auth/pair')
  async pair(@Body() body: { code?: string; deviceName?: string }) {
    const code = (body?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('A 6-digit pairing code is required.');
    }
    try {
      return await this.users.redeemPairCode(code, body?.deviceName);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Post('auth/unpair')
  @UseGuards(MobileAuthGuard)
  async unpair(@Req() req: MobileRequest) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    await this.users.revoke(token);
    return { ok: true };
  }

  // ─── Who am I ───────────────────────────────────────────────────────
  @Get('me')
  @UseGuards(MobileAuthGuard)
  async me(@Req() req: MobileRequest) {
    const s = await this.settings.get(req.userId);
    return {
      userId: req.userId,
      gmailConnected: !!s.gmailRefreshToken,
      settings: {
        scope: s.scope,
        emailRange: s.emailRange,
        briefingsEnabled: s.briefingsEnabled,
      },
    };
  }

  // ─── Chat — the agent handles anything (routes to a specialist) ─────
  @Post('chat')
  @UseGuards(MobileAuthGuard)
  async chat(@Req() req: MobileRequest, @Body() body: { message?: string }) {
    const message = (body?.message ?? '').trim();
    if (!message) throw new BadRequestException('message is required.');
    const reply = await this.agent.handle(req.userId, message);
    return { reply };
  }

  // ─── Email summaries ────────────────────────────────────────────────
  @Get('emails')
  @UseGuards(MobileAuthGuard)
  async emails(
    @Req() req: MobileRequest,
    @Query('range') range?: EmailRangeParam,
  ) {
    const timeRange: EmailRangeParam = range ?? 'today';
    try {
      const emails = await this.gmail.fetchRecent(req.userId, 15, timeRange);
      return {
        emails: emails.map((e) => ({
          id: e.id,
          threadId: e.threadId,
          from: e.from,
          subject: e.subject,
          date: e.date,
          snippet: e.snippet,
        })),
      };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  // ─── Calendar summary (natural-language string) ─────────────────────
  @Get('meetings')
  @UseGuards(MobileAuthGuard)
  async meetings(
    @Req() req: MobileRequest,
    @Query('range') range?: MeetingRangeParam,
  ) {
    const text = await this.calendarSpec.run(req.userId, '', {
      timeRange: range ?? 'today',
    });
    return { text };
  }

  // ─── Drafts awaiting approval (HITL) ────────────────────────────────
  @Get('drafts')
  @UseGuards(MobileAuthGuard)
  async drafts(@Req() req: MobileRequest) {
    const pending = await this.hitl.listPending(req.userId);
    const drafts = await Promise.all(
      pending.map(async (d) => {
        const intr = await this.hitl.currentInterrupt(d.id);
        if (intr?.kind === 'approve') {
          return {
            id: d.id,
            status: d.status,
            kind: 'approve' as const,
            recipient: intr.draft.recipientName,
            subject: intr.draft.subject,
            body: intr.draft.body,
            createdAt: d.createdAt,
          };
        }
        if (intr?.kind === 'choose_sender') {
          return {
            id: d.id,
            status: d.status,
            kind: 'choose_sender' as const,
            recipient: intr.recipient,
            candidates: intr.candidates,
            createdAt: d.createdAt,
          };
        }
        return {
          id: d.id,
          status: d.status,
          kind: 'unknown' as const,
          recipient: d.recipient,
          subject: d.subject,
          createdAt: d.createdAt,
        };
      }),
    );
    return { drafts };
  }

  @Post('drafts/:id/approve')
  @UseGuards(MobileAuthGuard)
  async approve(@Param('id') id: string) {
    return this.outcome(await this.hitl.approve(id));
  }

  @Post('drafts/:id/cancel')
  @UseGuards(MobileAuthGuard)
  async cancel(@Param('id') id: string) {
    return this.outcome(await this.hitl.cancel(id));
  }

  // Edit a draft: mode 'ai' revises via the model, 'replace' sets the body verbatim.
  @Post('drafts/:id/edit')
  @UseGuards(MobileAuthGuard)
  async edit(
    @Param('id') id: string,
    @Body() body: { mode?: 'ai' | 'replace'; text?: string },
  ) {
    const text = (body?.text ?? '').trim();
    if (!text) throw new BadRequestException('text is required.');
    if (body?.mode === 'replace') return this.outcome(await this.hitl.replaceBody(id, text));
    return this.outcome(await this.hitl.applyEdit(id, text));
  }

  // ─── Settings ───────────────────────────────────────────────────────
  @Get('settings')
  @UseGuards(MobileAuthGuard)
  async getSettings(@Req() req: MobileRequest) {
    const s = await this.settings.get(req.userId);
    return {
      scope: s.scope,
      emailRange: s.emailRange,
      briefingsEnabled: s.briefingsEnabled,
    };
  }

  @Patch('settings')
  @UseGuards(MobileAuthGuard)
  async patchSettings(
    @Req() req: MobileRequest,
    @Body()
    body: { scope?: Scope; emailRange?: EmailRange; briefingsEnabled?: boolean },
  ) {
    if (body.scope) await this.settings.setScope(req.userId, body.scope);
    if (body.emailRange) await this.settings.setRange(req.userId, body.emailRange);
    if (typeof body.briefingsEnabled === 'boolean') {
      await this.settings.setBriefings(req.userId, body.briefingsEnabled);
    }
    return this.getSettings(req);
  }

  // Normalize a HITL outcome into a compact JSON shape for the app.
  private outcome(o: HitlOutcome) {
    if (o.type === 'interrupt') {
      return { id: o.draftId, state: 'awaiting', kind: o.payload.kind };
    }
    if (o.type === 'error') return { id: o.draftId, state: 'error', message: o.message };
    return { id: o.draftId, state: o.status, recipient: o.recipient };
  }
}
