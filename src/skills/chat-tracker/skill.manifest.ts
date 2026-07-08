import { defineManifest } from '../manifest.schema';

export const chatTrackerManifest = defineManifest({
  name: 'chat_tracker',
  version: '1.0.0',
  description:
    'extract entities/relations from a STATEMENT the user makes (facts about ' +
    'themselves, people, places, preferences). Pick this when the user is ' +
    'teaching you something.',
  sideEffects: false,
  tools: ['memory.write'],
});
