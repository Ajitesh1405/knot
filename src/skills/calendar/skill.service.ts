import { Injectable } from '@nestjs/common';
import { CalendarSpecialist } from '../../agent/calendar.specialist';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { calendarManifest } from './skill.manifest';

/** Adapter: reads the calendar, coercing 'all' → 'this_week' (no 'all' bucket). */
@Injectable()
export class CalendarSkill implements KnotSkill {
  readonly manifest = calendarManifest;
  constructor(private readonly calendar: CalendarSpecialist) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const tr = ctx.params?.timeRange;
    const text = await this.calendar.run(ctx.userId, ctx.message, {
      timeRange: tr === 'all' ? 'this_week' : tr,
    });
    return { text };
  }
}
