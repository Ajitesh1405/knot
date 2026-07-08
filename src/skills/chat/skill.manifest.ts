import { defineManifest } from '../manifest.schema';

export const chatManifest = defineManifest({
  name: 'chat',
  version: '1.0.0',
  description:
    'small talk, greetings, thanks, "how are you", "what can you do", or ' +
    'anything conversational that is NOT a task. Reply warmly via this.',
  sideEffects: false,
  terminal: true,
  tools: ['memory.read'],
});
