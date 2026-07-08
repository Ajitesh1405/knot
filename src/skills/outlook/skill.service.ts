import { Injectable } from '@nestjs/common';
import {
  OutlookSpecialist,
  OutlookRunParams,
} from '../../agent/outlook.specialist';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { outlookManifest } from './skill.manifest';

/** Adapter: reads Outlook via OutlookSpecialist, same tomorrow→all coercion. */
@Injectable()
export class OutlookSkill implements KnotSkill {
  readonly manifest = outlookManifest;
  constructor(private readonly outlook: OutlookSpecialist) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const p = ctx.params;
    const params: OutlookRunParams = {
      ...p,
      timeRange: p?.timeRange === 'tomorrow' ? 'all' : p?.timeRange,
    };
    const text = await this.outlook.run(ctx.userId, ctx.message, params);
    return { text };
  }
}
