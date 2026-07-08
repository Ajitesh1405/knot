import { defineManifest } from '../manifest.schema';

export const gmailManifest = defineManifest({
  name: 'gmail',
  version: '1.0.0',
  description:
    'read Gmail emails and answer email-related questions. Pick gmail for ' +
    'Gmail/Google mail. Extract time hints into parameters.timeRange: ' +
    '"today" (default / "emails today"), "this_week" (this week / last 7 days), ' +
    '"all" (all my emails / everything in inbox).',
  sideEffects: false,
  requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  tools: ['gmail.read'],
});
