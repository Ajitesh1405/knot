import { Injectable, Logger } from '@nestjs/common';
import { SupervisorService } from './supervisor.service';
import { ChatSpecialist } from './chat.specialist';
import { ConversationService } from './conversation.service';
import { SearchSpecialist } from './search.specialist';
import { ChatTrackerSpecialist } from './chat-tracker.specialist';
import { GraphService } from '../graph/graph.service';
import { GmailSpecialist, GmailRunParams } from './gmail.specialist';
import { CalendarSpecialist } from './calendar.specialist';
import { OutlookSpecialist, OutlookRunParams } from './outlook.specialist';
import { SchedulerHitlService } from './scheduler-hitl.service';
import { ComposeHitlService } from './compose-hitl.service';

const MAX_TURNS = 5; // safety rail — no infinite supervisor loops

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly supervisor: SupervisorService,
    private readonly chat: ChatSpecialist,
    private readonly conversation: ConversationService,
    private readonly search: SearchSpecialist,
    private readonly gmailSpec: GmailSpecialist,
    private readonly outlookSpec: OutlookSpecialist,
    private readonly calendarSpec: CalendarSpecialist,
    private readonly schedulerHitl: SchedulerHitlService,
    private readonly composeHitl: ComposeHitlService,
    private readonly tracker: ChatTrackerSpecialist,
    private readonly graph: GraphService,
  ) {}

  // ─── Single entry point: supervisor decides what to do ──────────────
  async handle(userId: string, message: string): Promise<string> {
    const history: string[] = [];
    let finalAnswer = '';

    // Conversation context (last turns) BEFORE recording this message, so the
    // agent can resolve follow-ups like "reply to him" / "the same person".
    const convo = this.conversation.recentText(userId);
    this.conversation.append(userId, 'user', message);

    // Passive learning — grow the graph from ordinary chat, in the background.
    void this.tracker
      .learn(userId, message)
      .catch((err) => this.logger.warn(`passive learn failed: ${err.message}`));

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const decision = await this.supervisor.decide(message, history, convo);
      this.logger.log(`turn ${turn}: ${decision.next} — ${decision.reason}`);

      if (decision.next === 'FINISH') break;

      // Run the chosen specialist
      let result: string;
      if (decision.next === 'chat') {
        result = await this.chat.run(userId, message, convo);
      } else if (decision.next === 'search') {
        result = await this.search.run(userId, message);
      } else if (decision.next === 'chat_tracker') {
        result = await this.tracker.run(userId, message);
      } else if (decision.next === 'gmail') {
        // Gmail doesn't understand 'tomorrow' — coerce it so its type stays put.
        const p = decision.parameters;
        const gmailParams: GmailRunParams = {
          ...p,
          timeRange: p?.timeRange === 'tomorrow' ? 'all' : p?.timeRange,
        };
        result = await this.gmailSpec.run(userId, message, gmailParams);
        console.log(`[agent] gmail returned length=${result?.length}`);
      } else if (decision.next === 'outlook') {
        const p = decision.parameters;
        const outlookParams: OutlookRunParams = {
          ...p,
          timeRange: p?.timeRange === 'tomorrow' ? 'all' : p?.timeRange,
        };
        result = await this.outlookSpec.run(userId, message, outlookParams);
      } else if (decision.next === 'calendar') {
        // Calendar has no 'all' bucket — treat it as the whole week.
        const tr = decision.parameters?.timeRange;
        result = await this.calendarSpec.run(userId, message, {
          timeRange: tr === 'all' ? 'this_week' : tr,
        });
      } else if (decision.next === 'scheduler') {
        // HITL: kick off slot-finding; the approval card arrives async via
        // Telegram. Context lets it resolve "with him" to a prior name.
        result = await this.schedulerHitl.start(
          userId,
          this.withContext(message, convo),
        );
      } else if (decision.next === 'compose') {
        // HITL: kick off drafting; the approval card arrives async.
        result = this.composeHitl.kickoff(
          userId,
          this.withContext(message, convo),
        );
      } else {
        result = '(unknown specialist)';
      }

      // Log what just happened so supervisor knows next turn
      finalAnswer = result; // ← THE FIX
      history.push(`${decision.next}: ${result}`);

      // Terminal routes: a conversational reply (chat) or a fire-and-forget
      // HITL kickoff (scheduler) completes the turn — don't re-route, or the
      // supervisor spawns duplicate drafts.
      if (
        decision.next === 'chat' ||
        decision.next === 'scheduler' ||
        decision.next === 'compose'
      )
        break;
    }

    const answer = finalAnswer || '(no specialist produced an answer)';
    this.conversation.append(userId, 'assistant', answer);
    return answer;
  }

  // Prepend recent conversation so an instruction's referents resolve.
  private withContext(message: string, convo: string): string {
    if (!convo || convo === '(no prior messages)') return message;
    return `Recent conversation:\n${convo}\n\nCurrent request: ${message}`;
  }

  async getMemory(userId: string) {
    return this.graph.getAll(userId);
  }
}
