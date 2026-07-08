import { Injectable } from '@nestjs/common';
import { GmailSpecialist, GmailRunParams } from '../../agent/gmail.specialist';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { gmailManifest } from './skill.manifest';

/** Adapter: reads Gmail via GmailSpecialist, preserving the tomorrow→all coercion. */
@Injectable()
export class GmailSkill implements KnotSkill {
  readonly manifest = gmailManifest;
  constructor(private readonly gmail: GmailSpecialist) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const p = ctx.params;
    // Gmail doesn't understand 'tomorrow' — coerce it so its type stays put.
    const params: GmailRunParams = {
      ...p,
      timeRange: p?.timeRange === 'tomorrow' ? 'all' : p?.timeRange,
    };
    const text = await this.gmail.run(ctx.userId, ctx.message, params);
    return { text };
  }
}
