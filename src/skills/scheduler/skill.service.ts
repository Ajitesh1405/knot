import { Injectable } from '@nestjs/common';
import { SchedulerHitlService } from '../../agent/scheduler-hitl.service';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { withConversation } from '../skill.util';
import { schedulerManifest } from './skill.manifest';

/**
 * Adapter: starts slot-finding via the scheduler HITL graph. The approval card
 * arrives async via Telegram (SchedulerHitlService.events$); terminal so the
 * supervisor doesn't re-route and double-schedule.
 */
@Injectable()
export class SchedulerSkill implements KnotSkill {
  readonly manifest = schedulerManifest;
  constructor(private readonly schedulerHitl: SchedulerHitlService) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const text = await this.schedulerHitl.start(
      ctx.userId,
      withConversation(ctx.message, ctx.conversation),
    );
    return { text, terminal: true };
  }
}
