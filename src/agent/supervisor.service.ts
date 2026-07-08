import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import { RouteSchema, Route } from './supervisor';
import { LlmService } from 'src/llm/llm.service';
import { SkillRegistry } from '../skills/skill.registry';

@Injectable()
export class SupervisorService {
  private readonly chain: Runnable<Record<string, string>, Route>;

  constructor(
    private readonly llm: LlmService,
    private readonly registry: SkillRegistry,
  ) {
    const model = this.llm.build('fast');
    // The {specialists} slot is filled per-invocation from the skill registry —
    // routing is NEVER a hard-coded list. Only the RULES are static.
    this.chain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You are the supervisor of a personal-assistant team.\n\n' +
          'Specialists:\n{specialists}\n\n' +
          'RULES:\n' +
          '- Pick ONE specialist per turn (use its exact name).\n' +
          '- After a specialist runs, decide if more work is needed or FINISH.\n' +
          '- For greetings/small talk/"what can you do" → pick chat (NOT FINISH).\n' +
          '- Always include parameters.timeRange when picking gmail, outlook, or calendar.\n' +
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
    userId: string,
    message: string,
    history: string[],
    conversation = '(no prior messages)',
  ): Promise<Route> {
    const historyText = history.length
      ? history.map((h, i) => `${i + 1}. ${h}`).join('\n')
      : '(nothing yet)';
    const specialists = await this.registry.routingSection(userId);
    const decision = await this.chain.invoke({
      message,
      history: historyText,
      conversation,
      specialists,
    });

    // Defend against a hallucinated / disabled skill name: fall back to chat
    // so the user always gets a reply rather than an "unknown specialist".
    if (decision.next !== 'FINISH') {
      const routable = await this.registry.routableNames(userId);
      if (!routable.has(decision.next)) {
        return {
          next: 'chat',
          reason: `Requested "${decision.next}" is unavailable; replying conversationally.`,
          parameters: decision.parameters,
        };
      }
    }
    return decision;
  }
}
