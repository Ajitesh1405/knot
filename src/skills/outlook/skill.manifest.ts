import { defineManifest } from '../manifest.schema';

export const outlookManifest = defineManifest({
  name: 'outlook',
  version: '1.0.0',
  description:
    'read Outlook/Microsoft email and answer Outlook-related questions ' +
    '("my outlook emails", "check outlook", "work email"). Same timeRange ' +
    'hints as gmail. Pick outlook for Outlook/Microsoft/work mail.',
  sideEffects: false,
  tools: ['outlook.read'],
});
