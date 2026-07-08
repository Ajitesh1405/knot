import { Injectable } from '@nestjs/common';
import { ChatSpecialist } from '../../agent/chat.specialist';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { chatManifest } from './skill.manifest';

/** Adapter: routes conversational turns to the existing ChatSpecialist. */
@Injectable()
export class ChatSkill implements KnotSkill {
  readonly manifest = chatManifest;
  constructor(private readonly chat: ChatSpecialist) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const text = await this.chat.run(ctx.userId, ctx.message, ctx.conversation);
    return { text };
  }
}
