import { defineManifest } from '../manifest.schema';

export const calendarManifest = defineManifest({
  name: 'calendar',
  version: '1.0.0',
  description:
    'read the calendar and answer questions about meetings/events ' +
    '("what\'s on my calendar", "any meetings with Sarah", "am I free ' +
    'tomorrow"). Extract time hints into parameters.timeRange: "today" ' +
    '(default), "tomorrow", "this_week" (this week / next 7 days).',
  sideEffects: false,
  tools: ['calendar.read'],
});
