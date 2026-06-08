import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import { Runnable } from '@langchain/core/runnables';
import { GmailService } from '../gmail/gmail.service';
import { GraphService } from '../graph/graph.service';
import { SettingsService } from '../settings/settings.service';
import { LlmService } from 'src/llm/llm.service';

// ─── Schemas ────────────────────────────────────────────────────────
const ClassificationSchema = z.object({
  isPersonal: z
    .boolean()
    .describe('True if a real human is writing to the user.'),
  category: z.enum([
    'personal',
    'newsletter',
    'transactional',
    'promo',
    'automated',
  ]),
});
type Classification = z.infer<typeof ClassificationSchema>;

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
        .describe('Relation verb in SNAKE_CASE: SENT_BY, WORKS_AT, REQUESTED.'),
    }),
  ),
});
type Extraction = z.infer<typeof ExtractionSchema>;

// ─── Parameter type from supervisor ─────────────────────────────────
export type GmailRunParams = {
  timeRange?: 'today' | 'this_week' | 'all' | 'unspecified';
  limit?: number;
};

@Injectable()
export class GmailSpecialist {
  private readonly classifyChain: Runnable<
    Record<string, string>,
    Classification
  >;
  private readonly extractChain: Runnable<Record<string, string>, Extraction>;
  private readonly summaryChain: Runnable<Record<string, string>, string>;

  constructor(
    private readonly llm: LlmService,
    private readonly gmail: GmailService,
    private readonly graph: GraphService,
    private readonly settings: SettingsService,
  ) {
    const model = this.llm.build('fast');

    this.classifyChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'Classify if an email is personal (human-to-human) or automated.',
      ],
      ['user', 'From: {from}\nSubject: {subject}\nSnippet: {snippet}'],
    ]).pipe(model.withStructuredOutput(ClassificationSchema));

    this.extractChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        "Extract entities/relations from this email. Always include a 'User' entity " +
          '(the recipient). The sender becomes a Person node with email/company info. ' +
          'Topics, deadlines, mentioned people = entities. Relations in SNAKE_CASE.',
      ],
      ['user', 'From: {from}\nSubject: {subject}\nBody:\n{body}'],
    ]).pipe(model.withStructuredOutput(ExtractionSchema));

    this.summaryChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You are a helpful assistant summarizing emails for a busy user on Telegram. ' +
          "Write naturally, like you're texting a friend.\n" +
          'RULES:\n' +
          '- Lead with the most important: real personal messages, urgent items, deadlines.\n' +
          '- Group similar emails (e.g., "3 job alerts").\n' +
          '- Skip newsletters and promos unless something stands out.\n' +
          '- Short sentences. No markdown headers, no bullet symbols.\n' +
          '- Max 5 short lines.\n' +
          '- Use emojis sparingly: 📧 new mail, ⏰ deadlines, 🎯 action items.',
      ],
      [
        'user',
        'Time range: {timeRange}\n\nEmails:\n{emails}\n\nUser asked: {question}',
      ],
    ])
      .pipe(model)
      .pipe(new StringOutputParser());
  }

  // ─── Main entry — called by supervisor with optional params ─────────
  async run(
    userId: string,
    question: string,
    params?: GmailRunParams,
  ): Promise<string> {
    // Sensible defaults: today, 10 emails. "unspecified" maps to "today".
    const requested = params?.timeRange ?? 'today';
    const timeRange = requested === 'unspecified' ? 'today' : requested;
    const limit = params?.limit ?? 10;

    console.log(
      `[gmail-spec] running — timeRange=${timeRange}, limit=${limit}`,
    );

    // 1. Fetch
    const emails = await this.gmail.fetchRecent(userId, limit, timeRange);
    console.log(`[gmail-spec] fetched ${emails.length} emails`);

    if (emails.length === 0) {
      const when =
        timeRange === 'today'
          ? ' today'
          : timeRange === 'this_week'
            ? ' this week'
            : '';
      return `No emails in your inbox${when}.`;
    }

    // 2. Filter
    const settings = await this.settings.get(userId);
    const eligible =
      settings.scope === 'everything'
        ? emails
        : await this.filterPersonal(emails);
    console.log(`[gmail-spec] ${eligible.length} eligible after filter`);

    // 3. Extract entities into graph (failures don't block summary)
    for (const email of eligible) {
      try {
        await this.extractAndStore(userId, email);
      } catch (err: any) {
        console.warn(
          `[gmail-spec] extraction failed for "${email.subject}": ${err.message}`,
        );
      }
    }

    // 4. Build prompt input, capped to prevent silent truncation
    const emailsText = emails
      .map((e) => `From ${e.from} | ${e.subject}\n${e.snippet}`)
      .join('\n\n---\n\n')
      .slice(0, 8000);

    // 5. Summarize with fallback
    try {
      const result = await this.summaryChain.invoke({
        timeRange,
        emails: emailsText,
        question,
      });
      console.log(`[gmail-spec] summary length: ${result?.length}`);
      return result || `Fetched ${emails.length} emails but summary was empty.`;
    } catch (err: any) {
      console.error(`[gmail-spec] summary failed: ${err.message}`);
      return `Fetched ${emails.length} emails, but summarizing failed: ${err.message}`;
    }
  }

  // ─── Heuristic + LLM filter ────────────────────────────────────────
  private async filterPersonal(emails: any[]) {
    const personal: any[] = [];
    for (const email of emails) {
      const h = this.heuristicCheck(email);
      if (h === 'personal') {
        personal.push(email);
      } else if (h === 'automated') {
        continue;
      } else {
        const result = await this.classifyChain.invoke({
          from: email.from,
          subject: email.subject,
          snippet: email.snippet,
        });
        if (result.isPersonal) personal.push(email);
      }
    }
    return personal;
  }

  private heuristicCheck(email: any): 'personal' | 'automated' | 'ambiguous' {
    const from = (email.from ?? '').toLowerCase();
    const subject = (email.subject ?? '').toLowerCase();
    if (from.includes('no-reply') || from.includes('noreply'))
      return 'automated';
    if (from.includes('mailer-daemon')) return 'automated';
    if (subject.includes('unsubscribe') || subject.includes('newsletter'))
      return 'automated';
    if (/\b(otp|verification code|verify your)\b/i.test(subject))
      return 'automated';
    if (/^[a-z]+\.[a-z]+@/.test(from)) return 'personal';
    return 'ambiguous';
  }

  private async extractAndStore(userId: string, email: any) {
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
