import { Injectable } from '@nestjs/common';
import { ComposeHitlService } from '../../agent/compose-hitl.service';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { withConversation } from '../skill.util';
import { composeManifest } from './skill.manifest';

/**
 * Adapter: kicks off the compose HITL graph. The approval card arrives async
 * via Telegram (ComposeHitlService.events$), so this returns immediately and
 * the turn is terminal — re-routing would spawn duplicate drafts.
 */
@Injectable()
export class ComposeSkill implements KnotSkill {
  readonly manifest = composeManifest;
  constructor(private readonly composeHitl: ComposeHitlService) {}

  execute(ctx: SkillContext): Promise<SkillResult> {
    const text = this.composeHitl.kickoff(
      ctx.userId,
      withConversation(ctx.message, ctx.conversation),
    );
    return Promise.resolve({ text, terminal: true });
  }
}
