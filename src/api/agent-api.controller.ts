import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { ComposeHitlService } from '../agent/compose-hitl.service';
import { CalendarSpecialist } from '../agent/calendar.specialist';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { draftEditSchema, messageSchema, parseBody } from '../auth/validation';

type MeetingRange = 'today' | 'tomorrow' | 'this_week';

// All routes require a valid access token; the userId comes from the
// token, never from the client — a caller can only act as themselves.
@UseGuards(JwtAuthGuard)
@Controller('api/agent')
export class AgentApiController {
  constructor(
    private readonly agent: AgentService,
    private readonly composeHitl: ComposeHitlService,
    private readonly calendar: CalendarSpecialist,
    private readonly db: PrismaService,
  ) {}

  // ─── Chat with the assistant ───────────────────────────────────
  @Post('message')
  @HttpCode(200)
  async message(
    @CurrentUser('userId') userId: string,
    @Body() body: unknown,
  ) {
    const { text } = parseBody(messageSchema, body);
    const answer = await this.agent.handle(userId, text);
    return { answer };
  }

  // ─── Knowledge graph (nodes + edges) ───────────────────────────
  @Get('memory')
  memory(@CurrentUser('userId') userId: string) {
    return this.agent.getMemory(userId);
  }

  // ─── Calendar / meetings summary ───────────────────────────────
  @Get('meetings')
  async meetings(
    @CurrentUser('userId') userId: string,
    @Query('range') range?: string,
  ) {
    const tr: MeetingRange = (['today', 'tomorrow', 'this_week'] as const).includes(
      range as MeetingRange,
    )
      ? (range as MeetingRange)
      : 'today';
    const text = await this.calendar.run(userId, `meetings ${tr}`, {
      timeRange: tr,
    });
    return { range: tr, text };
  }

  // ─── Email drafts awaiting approval (HITL) ─────────────────────
  @Get('drafts')
  async drafts(@CurrentUser('userId') userId: string) {
    return { drafts: await this.composeHitl.listPending(userId) };
  }

  @Post('drafts/:id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    await this.assertOwnsDraft(userId, id);
    return this.composeHitl.approve(id);
  }

  @Post('drafts/:id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    await this.assertOwnsDraft(userId, id);
    return this.composeHitl.cancel(id);
  }

  // Edit a draft: `body` replaces it verbatim, `instruction` asks the
  // AI to revise it.
  @Post('drafts/:id/edit')
  @HttpCode(200)
  async edit(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() payload: unknown,
  ) {
    await this.assertOwnsDraft(userId, id);
    const { instruction, body } = parseBody(draftEditSchema, payload);
    return body != null
      ? this.composeHitl.replaceBody(id, body)
      : this.composeHitl.applyEdit(id, instruction!);
  }

  // A draftId is a cuid, but never trust the client — confirm the
  // draft belongs to this user before acting on it.
  private async assertOwnsDraft(userId: string, id: string) {
    const draft = await this.db.pendingDraft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.userId !== userId) {
      throw new ForbiddenException('This draft belongs to another user');
    }
  }
}
