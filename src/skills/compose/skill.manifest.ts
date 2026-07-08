import { defineManifest } from '../manifest.schema';

export const composeManifest = defineManifest({
  name: 'compose',
  version: '1.0.0',
  description:
    'DRAFT and SEND an email or reply. Pick this when the user wants to ' +
    'write/send/reply to someone ("reply to Sarah saying…", "email John ' +
    'about…", "send X a note"). This WRITES email; gmail/outlook only READ.',
  // Writes email — every send goes through the compose HITL approval card.
  sideEffects: true,
  terminal: true,
  requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
  tools: ['email.send', 'email.reply'],
});
