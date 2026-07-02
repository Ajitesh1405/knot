import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import { LlmService } from '../llm/llm.service';
import { ParsedEmail } from '../gmail/gmail.service';

// ─── Triage verdict ─────────────────────────────────────────────────
export const TriageSchema = z.object({
  needsReply: z
    .boolean()
    .describe(
      'true ONLY if a real person is directly asking the user for a response',
    ),
  importance: z
    .enum(['low', 'normal', 'high'])
    .describe('how time-sensitive / consequential a reply is'),
  reason: z.string().describe('one short sentence explaining the verdict'),
});
export type TriageVerdict = z.infer<typeof TriageSchema>;

@Injectable()
export class TriageSpecialist {
  private readonly logger = new Logger(TriageSpecialist.name);
  private readonly chain: Runnable<Record<string, string>, TriageVerdict>;

  constructor(private readonly llm: LlmService) {
    const model = this.llm.build('fast');
    this.chain = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You triage the user’s inbox to decide whether an email genuinely ' +
          'NEEDS a personal reply from them. Be CONSERVATIVE — when in doubt, ' +
          'answer needsReply=false. It is far better to stay silent than to ' +
          'nag the user about mail that does not need a response.\n\n' +
          'needsReply = true ONLY when ALL of these hold:\n' +
          '  • the sender is a real human (not a system/no-reply/marketing bot),\n' +
          '  • the message is addressed to the user personally (not bulk/FYI),\n' +
          '  • it contains a clear question, request, or expectation of a reply.\n\n' +
          'needsReply = false for: newsletters, marketing, notifications, ' +
          'receipts, calendar/system mail, automated alerts, "no action needed" ' +
          'FYIs, and anything mass-sent. importance: high = urgent/time-boxed ' +
          'ask; normal = ordinary request; low = minor or optional.\n' +
          'Give one short sentence of reasoning.',
      ],
      [
        'user',
        'From: {from}\nTo: {to}\nCc: {cc}\nSubject: {subject}\n\n{body}',
      ],
    ]).pipe(model.withStructuredOutput(TriageSchema));
  }

  async classify(email: ParsedEmail): Promise<TriageVerdict> {
    const body = (email.body || email.snippet || '').slice(0, 1500);
    try {
      return await this.chain.invoke({
        from: email.from,
        to: email.to,
        cc: email.cc || '(none)',
        subject: email.subject || '(no subject)',
        body: body || '(empty body)',
      });
    } catch (err: any) {
      // On any model/parse error, fail safe: don't surface a draft.
      this.logger.warn(`triage failed for ${email.id}: ${err.message}`);
      return { needsReply: false, importance: 'low', reason: 'triage error' };
    }
  }
}
