import { Injectable, Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';
import { GmailService } from '../gmail/gmail.service';
import { GraphService } from '../graph/graph.service';
import { LlmService } from 'src/llm/llm.service';

// A resolved sender we can reply to (shape returned by gmail.parseEmail).
export type Candidate = {
  from: string; // "Sarah Mehta <sarah@acme.com>"
  threadId: string;
  messageId: string;
  subject: string;
  body: string;
};

// ─── What a finished draft looks like ───────────────────────────────
export type EmailDraft = {
  to: string; // resolved address header, e.g. "Sarah Mehta <sarah@acme.com>"
  recipientName: string; // human label for Telegram, e.g. "Sarah"
  subject: string;
  body: string;
  threadId?: string; // reply within this Gmail thread
  inReplyTo?: string; // original Message-ID for threading headers
};

// The supervisor only knows the user's instruction; this chain pulls the
// recipient + intent out of it so we can resolve a real Gmail thread.
const IntentSchema = z.object({
  recipient: z
    .string()
    .describe('Name or email of the person to reply to, e.g. "Sarah".'),
  intent: z
    .string()
    .describe('What the user wants to say, in their own words.'),
});
export type Intent = z.infer<typeof IntentSchema>;

@Injectable()
export class ComposeSpecialist {
  private readonly logger = new Logger(ComposeSpecialist.name);
  private readonly intentChain: Runnable<Record<string, string>, Intent>;
  private readonly draftChain: Runnable<Record<string, string>, string>;
  private readonly subjectChain: Runnable<Record<string, string>, string>;

  constructor(
    private readonly llm: LlmService,
    private readonly gmail: GmailService,
    private readonly graph: GraphService,
  ) {
    const fast = this.llm.build('fast');
    const smart = this.llm.build('smart');

    this.intentChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        "Pull the recipient and the intended message out of the user's " +
          'instruction. Recipient is who the reply goes to. ' +
          'Intent is what they want to convey, paraphrased faithfully.',
      ],
      ['user', '{instruction}'],
    ]).pipe(fast.withStructuredOutput(IntentSchema));

    // Drafting is the quality-sensitive step → smart model.
    this.draftChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You write email replies on behalf of the user. ' +
          'Match a warm, concise, professional tone. ' +
          'Use what you know about the recipient for context, but never ' +
          'invent facts. Output ONLY the email body — no subject, no ' +
          'salutation placeholders like [Name], no markdown.',
      ],
      [
        'user',
        'You are replying to {recipientName}.\n\n' +
          'What you know about them:\n{context}\n\n' +
          'Their last message:\n{lastMessage}\n\n' +
          'The user wants to say: {intent}',
      ],
    ])
      .pipe(smart)
      .pipe(new StringOutputParser());

    // Short subject line for brand-new emails (no thread to inherit one from).
    this.subjectChain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'Write a short, specific email subject line (max 8 words) for this ' +
          'message. Output ONLY the subject — no quotes, no "Subject:" prefix.',
      ],
      ['user', '{intent}'],
    ])
      .pipe(fast)
      .pipe(new StringOutputParser());
  }

  // Does this string look like a bare email address?
  isEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  }

  // ─── Pull recipient + intent out of the user's free-text instruction ─
  parseIntent(instruction: string): Promise<Intent> {
    return this.intentChain.invoke({ instruction });
  }

  // ─── Find distinct senders matching the recipient name/address ──────
  resolveCandidates(userId: string, recipient: string): Promise<Candidate[]> {
    return this.gmail.findCandidateSenders(userId, recipient);
  }

  // ─── Draft a reply to a chosen sender ───────────────────────────────
  async draftReply(
    userId: string,
    chosen: Candidate,
    intent: string,
  ): Promise<EmailDraft> {
    const address = this.gmail.addressOf(chosen.from);
    const display = chosen.from.replace(/<[^>]+>/, '').trim() || address;

    // Don't reply INTO a calendar-invite / automated thread — that produces a
    // confusing "Re: Invitation: …" subject. Send a fresh email instead.
    if (this.isAutomatedSubject(chosen.subject)) {
      this.logger.log(
        `compose: "${chosen.subject}" looks automated — drafting fresh email to ${address}`,
      );
      return this.draftNew(userId, address, intent);
    }

    // Aliases so "Sarah Mehta", "Sarah", and "sarah.mehta" all hit the node.
    const aliases = this.aliasesFor(display, address);
    const context = await this.graph.getFactsAbout(userId, aliases);

    const body = await this.draftChain.invoke({
      recipientName: display,
      context,
      lastMessage: chosen.body.slice(0, 2000),
      intent,
    });

    const subject = chosen.subject.toLowerCase().startsWith('re:')
      ? chosen.subject
      : `Re: ${chosen.subject}`;

    this.logger.log(`compose: drafted reply to ${display} <${address}>`);
    return {
      to: chosen.from,
      recipientName: display,
      subject,
      body: body.trim(),
      threadId: chosen.threadId || undefined,
      inReplyTo: chosen.messageId || undefined,
    };
  }

  // Calendar invites / auto-notifications we shouldn't reply into.
  private isAutomatedSubject(subject: string): boolean {
    return /^(invitation:|invitation from|accepted:|declined:|tentative:|updated invitation|canceled event|cancelled event|notification:)/i.test(
      (subject ?? '').trim(),
    );
  }

  // ─── Draft a BRAND-NEW email to an address (no prior thread) ────────
  async draftNew(
    userId: string,
    toAddress: string,
    intent: string,
  ): Promise<EmailDraft> {
    const local = toAddress.split('@')[0];
    const display = local.replace(/[._-]+/g, ' '); // "jane.doe" → "jane doe"
    const context = await this.graph.getFactsAbout(
      userId,
      this.aliasesFor(display, toAddress),
    );

    const [body, subject] = await Promise.all([
      this.draftChain.invoke({
        recipientName: display,
        context,
        lastMessage: '(new email — no prior thread)',
        intent,
      }),
      this.subjectChain.invoke({ intent }),
    ]);

    this.logger.log(`compose: drafted NEW email to ${toAddress}`);
    return {
      to: toAddress,
      recipientName: display,
      subject: subject.trim() || '(no subject)',
      body: body.trim(),
      // no threadId / inReplyTo → Gmail starts a fresh thread
    };
  }

  // ─── Re-draft after the user's free-text correction (Edit flow) ─────
  async redraft(prev: EmailDraft, correction: string): Promise<EmailDraft> {
    const revised = await this.draftChain.invoke({
      recipientName: prev.recipientName,
      context: '(see prior draft)',
      lastMessage: prev.body,
      intent: `Revise the previous draft per this instruction: ${correction}`,
    });
    this.logger.log(`compose: redraft for "${prev.recipientName}"`);
    return { ...prev, body: revised.trim() };
  }

  // Build the set of name forms a person might appear as in the graph.
  private aliasesFor(display: string, address: string): string[] {
    const local = address.split('@')[0]; // "sarah.mehta"
    const fromLocal = local.replace(/[._-]+/g, ' '); // "sarah mehta"
    const firstName = display.split(/\s+/)[0]; // "Sarah"
    return [display, firstName, local, fromLocal];
  }
}
