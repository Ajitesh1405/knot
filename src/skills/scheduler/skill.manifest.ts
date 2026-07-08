import { defineManifest } from '../manifest.schema';

export const schedulerManifest = defineManifest({
  name: 'scheduler',
  version: '1.0.0',
  description:
    'CREATE a new meeting / set up a call. Pick this when the user wants to ' +
    'schedule something with someone ("schedule a meeting with X", "set up a ' +
    '1:1 with X tomorrow", "find time for a call with X next week"). This ' +
    'differs from calendar (which only READS existing events).',
  // Creates events + sends invites — always through the scheduler HITL card.
  sideEffects: true,
  terminal: true,
  requiredScopes: ['https://www.googleapis.com/auth/calendar.events'],
  tools: ['meeting.schedule', 'calendar.invite'],
});
