import { Provider } from '@nestjs/common';
import { KNOT_SKILLS, KnotSkill } from './skill.types';
import { ChatSkill } from './chat/skill.service';
import { SearchSkill } from './search/skill.service';
import { ChatTrackerSkill } from './chat-tracker/skill.service';
import { GmailSkill } from './gmail/skill.service';
import { OutlookSkill } from './outlook/skill.service';
import { CalendarSkill } from './calendar/skill.service';
import { ComposeSkill } from './compose/skill.service';
import { SchedulerSkill } from './scheduler/skill.service';

/** The adapter classes NestJS must instantiate as providers. */
export const BUILTIN_SKILL_PROVIDERS = [
  ChatSkill,
  SearchSkill,
  ChatTrackerSkill,
  GmailSkill,
  OutlookSkill,
  CalendarSkill,
  ComposeSkill,
  SchedulerSkill,
];

/**
 * Aggregates every built-in adapter into the KNOT_SKILLS array the registry
 * consumes. Adding a skill = add its class here (and to providers); routing
 * updates itself from the manifests.
 */
export const KNOT_SKILLS_PROVIDER: Provider = {
  provide: KNOT_SKILLS,
  useFactory: (...skills: KnotSkill[]) => skills,
  inject: BUILTIN_SKILL_PROVIDERS,
};
