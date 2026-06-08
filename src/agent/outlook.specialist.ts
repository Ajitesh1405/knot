import { Injectable, Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';
import { OutlookService, OutlookEmail } from '../outlook/outlook.service';
import { GraphService } from '../graph/graph.service';
import { LlmService } from 'src/llm/llm.service';

const ExtractionSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      entityType: z
        .string()
        .describe('Entity kind: Person, Company, Topic, etc.'),
    }),
  ),
  relations: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      relationType: z
        .string()
        .describe('Relation in SNAKE_CASE: SENT_BY, WORKS_AT, REQUESTED.'),
    }),
  ),
});
type Extraction = z.infer<typeof ExtractionSchema>;

export type OutlookRunParams = {
  timeRange?: 'today' | 'this_week' | 'all' | 'unspecified';
  limit?: number;
};

@Injectable()
export class OutlookSpecialist {
  private readonly logger = new Logger(OutlookSpecialist.name);
  private readonly extractChain: Runnable<Record<string, string>, Extraction>;
  private readonly summaryChain: Runnable<Record<string, string>, string>;

  constructor(
    private readonly outlook: OutlookService,
    private readonly graph: GraphService,
    private readonly llm: LlmService,
  ) {
    const model = this.llm.build('fast');

    this.extractChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        "Extract entities/relations from this Outlook email. Always include a 'User' " +
          'entity (the recipient). The sender becomes a Person node. ' +
          'Topics, deadlines, mentioned people = entities. Relations in SNAKE_CASE.',
      ],
      ['user', 'From: {from}\nSubject: {subject}\nBody:\n{body}'],
    ]).pipe(model.withStructuredOutput(ExtractionSchema));

    this.summaryChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You summarize Outlook emails for a busy user on Telegram. ' +
          "Write naturally, like texting a friend.\n" +
          'RULES:\n' +
          '- Lead with the most important: real personal messages, deadlines.\n' +
          '- Group similar emails. Skip obvious automated mail.\n' +
          '- Short sentences. No markdown headers. Max 5 short lines.\n' +
          '- Emojis sparingly: 📧 new mail, ⏰ deadlines, 🎯 action items.',
      ],
      ['user', 'Time range: {timeRange}\n\nEmails:\n{emails}\n\nUser asked: {question}'],
    ])
      .pipe(model)
      .pipe(new StringOutputParser());
  }

  async run(
    userId: string,
    question: string,
    params?: OutlookRunParams,
  ): Promise<string> {
    const requested = params?.timeRange ?? 'today';
    const timeRange = requested === 'unspecified' ? 'today' : requested;
    const limit = params?.limit ?? 10;

    let emails: OutlookEmail[];
    try {
      emails = await this.outlook.fetchRecent(userId, limit, timeRange);
    } catch (err: any) {
      return err.message; // e.g. "Outlook not connected…"
    }

    if (emails.length === 0) {
      const when =
        timeRange === 'today'
          ? ' today'
          : timeRange === 'this_week'
            ? ' this week'
            : '';
      return `No Outlook emails${when}.`;
    }

    // Store entities into the graph (failures don't block the summary).
    for (const email of emails) {
      try {
        await this.extractAndStore(userId, email);
      } catch (err: any) {
        this.logger.warn(`extract failed "${email.subject}": ${err.message}`);
      }
    }

    const emailsText = emails
      .map((e) => `From ${e.from} | ${e.subject}\n${e.snippet}`)
      .join('\n\n---\n\n')
      .slice(0, 8000);

    try {
      const result = await this.summaryChain.invoke({
        timeRange,
        emails: emailsText,
        question,
      });
      return result || `Fetched ${emails.length} Outlook emails.`;
    } catch (err: any) {
      this.logger.error(`summary failed: ${err.message}`);
      return `Fetched ${emails.length} Outlook emails, but summarizing failed.`;
    }
  }

  private async extractAndStore(userId: string, email: OutlookEmail) {
    const { entities, relations } = await this.extractChain.invoke({
      from: email.from,
      subject: email.subject,
      body: email.body.slice(0, 2000),
    });
    for (const e of entities) {
      await this.graph.upsertNode(userId, e.entityType, e.name);
    }
    for (const r of relations) {
      await this.graph.upsertRelation(userId, r.from, r.relationType, r.to);
    }
  }
}
