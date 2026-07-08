import { Injectable } from '@nestjs/common';
import { ChatTrackerSpecialist } from '../../agent/chat-tracker.specialist';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { chatTrackerManifest } from './skill.manifest';

/** Adapter: extracts graph facts from statements via ChatTrackerSpecialist. */
@Injectable()
export class ChatTrackerSkill implements KnotSkill {
  readonly manifest = chatTrackerManifest;
  constructor(private readonly tracker: ChatTrackerSpecialist) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const text = await this.tracker.run(ctx.userId, ctx.message);
    return { text };
  }
}
