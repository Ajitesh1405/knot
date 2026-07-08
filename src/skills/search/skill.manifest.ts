import { defineManifest } from '../manifest.schema';

export const searchManifest = defineManifest({
  name: 'search',
  version: '1.0.0',
  description:
    'read the memory graph to ANSWER a question about already-stored info.',
  sideEffects: false,
  tools: ['memory.read'],
});
