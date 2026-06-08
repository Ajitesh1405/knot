import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';
import { GraphService } from '../graph/graph.service';
import { LlmService } from 'src/llm/llm.service';

const ExtractionSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      entityType: z.string().describe('Person, Place, Topic, Preference, etc.'),
    }),
  ),
  relations: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      relationType: z
        .string()
        .describe('Relation in SNAKE_CASE: LIVES_IN, BROTHER_OF, etc.'),
    }),
  ),
});
type Extraction = z.infer<typeof ExtractionSchema>;

@Injectable()
export class ChatTrackerSpecialist {
  private readonly extractChain: Runnable<Record<string, string>, Extraction>;
  private readonly ackChain: Runnable<Record<string, string>, string>;

  constructor(
    private readonly graph: GraphService,
    private readonly llm: LlmService,
  ) {
    const model = this.llm.build('fast');

    // Chain 1: extract structure (unchanged)
    this.extractChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        "Extract entities and relationships from the user's statement. " +
          "Always include 'User' (entityType: Person) when 'I' or 'my' appears. " +
          "Expand implicit facts (e.g., 'common friend X' → both parties FRIEND_OF X). " +
          'relationType must be SNAKE_CASE.',
      ],
      ['user', 'Statement: {text}'],
    ]).pipe(model.withStructuredOutput(ExtractionSchema));

    // Chain 2: generate a natural acknowledgment
    this.ackChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You are a warm, casual assistant on Telegram. ' +
          'The user just told you something. Acknowledge it briefly in ONE short sentence, ' +
          "like you're texting a friend. No technical details, no lists, no markdown. " +
          'Examples:\n' +
          '  Input: "I live in Delhi" → "Got it, you live in Delhi. 📍"\n' +
          '  Input: "Rohit is my brother" → "Noted — Rohit is your brother."\n' +
          '  Input: "I prefer coffee over tea" → "Coffee it is then ☕"',
      ],
      ['user', '{text}'],
    ])
      .pipe(model)
      .pipe(new StringOutputParser());
  }

  // Passive learning: extract + store any facts, silently. Safe to call
  // fire-and-forget on every user message so the graph grows from chat.
  async learn(userId: string, text: string): Promise<void> {
    const extracted = await this.extractChain.invoke({ text });
    for (const e of extracted.entities) {
      await this.graph.upsertNode(userId, e.entityType, e.name);
    }
    for (const r of extracted.relations) {
      await this.graph.upsertRelation(userId, r.from, r.relationType, r.to);
    }
  }

  async run(userId: string, text: string): Promise<string> {
    // Extract + store (silently)
    const extracted = await this.extractChain.invoke({ text });

    for (const e of extracted.entities) {
      await this.graph.upsertNode(userId, e.entityType, e.name);
    }
    for (const r of extracted.relations) {
      await this.graph.upsertRelation(userId, r.from, r.relationType, r.to);
    }

    // If nothing extracted, give a soft "not sure what to save" reply
    if (extracted.entities.length === 0 && extracted.relations.length === 0) {
      return "Hmm, I didn't quite catch a fact to remember from that.";
    }

    // Generate a friendly acknowledgment in parallel
    const ack = await this.ackChain.invoke({ text });
    return ack || 'Got it, noted.';
  }
}
