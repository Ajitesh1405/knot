/**
 * Prepend recent conversation so an instruction's referents ("reply to him")
 * resolve. Mirrors the helper the AgentService used before skills existed, so
 * compose/scheduler kickoffs behave identically.
 */
export function withConversation(
  message: string,
  conversation: string,
): string {
  if (!conversation || conversation === '(no prior messages)') return message;
  return `Recent conversation:\n${conversation}\n\nCurrent request: ${message}`;
}
