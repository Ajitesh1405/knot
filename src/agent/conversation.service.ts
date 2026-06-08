import { Injectable } from '@nestjs/common';

type Turn = { role: 'user' | 'assistant'; content: string };

// Short-term working memory: the last few turns per user, so follow-ups like
// "reply to him" or "the same person" resolve. In-memory and capped — this is
// conversational context, not durable knowledge (that lives in the graph).
@Injectable()
export class ConversationService {
  private readonly store = new Map<string, Turn[]>();
  private readonly LIMIT = 10;

  append(userId: string, role: Turn['role'], content: string) {
    if (!content?.trim()) return;
    const turns = this.store.get(userId) ?? [];
    turns.push({ role, content: content.slice(0, 1000) });
    if (turns.length > this.LIMIT) turns.splice(0, turns.length - this.LIMIT);
    this.store.set(userId, turns);
  }

  recent(userId: string): Turn[] {
    return this.store.get(userId) ?? [];
  }

  // Formatted for prompt injection.
  recentText(userId: string): string {
    const turns = this.recent(userId);
    if (turns.length === 0) return '(no prior messages)';
    return turns.map((t) => `${t.role}: ${t.content}`).join('\n');
  }
}
