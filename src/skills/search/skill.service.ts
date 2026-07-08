import { Injectable } from '@nestjs/common';
import { SearchSpecialist } from '../../agent/search.specialist';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { searchManifest } from './skill.manifest';

/** Adapter: answers memory-graph questions via the existing SearchSpecialist. */
@Injectable()
export class SearchSkill implements KnotSkill {
  readonly manifest = searchManifest;
  constructor(private readonly search: SearchSpecialist) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const text = await this.search.run(ctx.userId, ctx.message);
    return { text };
  }
}
