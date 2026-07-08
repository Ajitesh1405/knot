import { Module } from '@nestjs/common';
import { SkillApprovalService } from './skill.approval';

/**
 * Transport-agnostic skill infrastructure that has no dependency on the
 * concrete specialists. The SkillRegistry itself is provided by AgentModule
 * (co-located with the KNOT_SKILLS provider that aggregates the adapters), so
 * registry construction and its skill list live in one module.
 */
@Module({
  providers: [SkillApprovalService],
  exports: [SkillApprovalService],
})
export class SkillsModule {}
