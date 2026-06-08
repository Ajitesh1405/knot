import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import { RouteSchema, Route } from './supervisor';
import { LlmService } from 'src/llm/llm.service';

@Injectable()
export class SupervisorService {
  private readonly chain: Runnable<Record<string, string>, Route>;

  constructor(private readonly llm: LlmService) {
    const model = this.llm.build('fast');
    this.chain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You are the supervisor of a personal-assistant team.\n\n' +
          'Specialists:\n' +
          '- chat: small talk, greetings, thanks, "how are you", "what can you do", ' +
          'or anything conversational that is NOT a task. Reply warmly via this.\n' +
          '- chat_tracker: extract entities/relations from a STATEMENT the user makes ' +
          '(facts about themselves, people, places, preferences). Pick this when the user ' +
          'is teaching you something.\n' +
          '- search: read the memory graph to ANSWER a question about already-stored info.\n' +
          '- gmail: read emails and answer email-related questions. ' +
          'Extract time hints into parameters.timeRange:\n' +
          '    "today"      → "emails today", "today\'s emails", or no time hint (default)\n' +
          '    "this_week"  → "this week", "last 7 days", "past week"\n' +
          '    "all"        → "all my emails", "everything in my inbox"\n' +
          '- outlook: read Outlook/Microsoft email and answer Outlook-related questions ' +
          '("my outlook emails", "check outlook", "work email"). Same timeRange hints as gmail. ' +
          'Pick gmail for Gmail/Google, outlook for Outlook/Microsoft/work mail.\n' +
          '- compose: DRAFT and SEND an email or reply. Pick this when the user wants to ' +
          'write/send/reply to someone ("reply to Sarah saying…", "email John about…", ' +
          '"send X a note"). This WRITES email; gmail/outlook only READ.\n' +
          '- calendar: read the calendar and answer questions about meetings/events ' +
          '("what\'s on my calendar", "what meetings do I have", "any meetings with Sarah", ' +
          '"am I free tomorrow"). Extract time hints into parameters.timeRange:\n' +
          '    "today"      → "today", or no time hint (default)\n' +
          '    "tomorrow"   → "tomorrow"\n' +
          '    "this_week"  → "this week", "next 7 days"\n' +
          '- scheduler: CREATE a new meeting / set up a call. Pick this when the user ' +
          'wants to schedule something with someone ("schedule a meeting with X", ' +
          '"set up a 1:1 with X tomorrow", "find time for a call with X next week"). ' +
          'This differs from calendar (which only READS existing events).\n' +
          '- FINISH: the request has already been handled by a specialist this turn.\n\n' +
          'RULES:\n' +
          '- Pick ONE specialist per turn.\n' +
          '- After a specialist runs, decide if more work is needed or FINISH.\n' +
          '- For greetings/small talk/"what can you do" → pick chat (NOT FINISH).\n' +
          '- Always include parameters.timeRange when picking gmail or calendar.\n' +
          '- Use the recent conversation to resolve references like "him", ' +
          '"that person", "the same one" when routing.\n' +
          '- Be decisive. One sentence of reasoning.',
      ],
      [
        'user',
        'Recent conversation:\n{conversation}\n\n' +
          'User message: {message}\n\nThis-turn history:\n{history}',
      ],
    ]).pipe(model.withStructuredOutput(RouteSchema));
  }

  async decide(
    message: string,
    history: string[],
    conversation = '(no prior messages)',
  ): Promise<Route> {
    const historyText = history.length
      ? history.map((h, i) => `${i + 1}. ${h}`).join('\n')
      : '(nothing yet)';
    return this.chain.invoke({ message, history: historyText, conversation });
  }
}
