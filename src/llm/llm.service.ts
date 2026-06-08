import { Injectable, Logger } from '@nestjs/common';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';

type ModelTier = 'chat' | 'fast' | 'smart';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  // ─── Returns a configured model for the requested tier ──────────
  build(tier: ModelTier = 'fast'): BaseChatModel {
    const provider = process.env.LLM_PROVIDER ?? 'anthropic';
    this.logger.log(`Using LLM provider: ${provider} (${tier})`);

    switch (provider) {
      case 'anthropic':
        return new ChatAnthropic({
          model:
            tier === 'smart'
              ? 'claude-sonnet-4-5'
              : tier === 'chat'
                ? (process.env.CHAT_MODEL ?? 'claude-haiku-4-5-20251001')
                : 'claude-haiku-4-5-20251001',
          // Casual chat wants a little warmth; tools/extraction stay deterministic.
          temperature: tier === 'chat' ? 0.6 : 0,
        });

      case 'openrouter':
        console.log(
          '[llm] OpenRouter key present:',
          !!process.env.OPENROUTER_API_KEY,
        );

        return new ChatOpenAI({
          model:
            process.env.OPENROUTER_MODEL ??
            'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          temperature: 0,
          apiKey: process.env.OPENROUTER_API_KEY, // ← 'apiKey', not 'openAIApiKey'
          configuration: {
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
              // Required by OpenRouter for usage tracking — set them or some routes 403
              'HTTP-Referer': 'http://localhost:3038',
              'X-Title': 'personal-agent',
            },
          },
        });

      case 'ollama':
        // Local model via Ollama — needs `ollama serve` running
        return new ChatOpenAI({
          model: process.env.OLLAMA_MODEL ?? 'llama3.1:8b',
          temperature: 0,
          openAIApiKey: 'ollama', // dummy — Ollama ignores it
          configuration: {
            baseURL: 'http://localhost:11434/v1',
          },
        });

      default:
        throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
    }
  }
}
