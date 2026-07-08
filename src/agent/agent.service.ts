import { Injectable, Logger } from '@nestjs/common';
import { SupervisorService } from './supervisor.service';
import { ConversationService } from './conversation.service';
import { ChatTrackerSpecialist } from './chat-tracker.specialist';
import { GraphService } from '../graph/graph.service';
import { SkillRegistry } from '../skills/skill.registry';

const MAX_TURNS = 5; // safety rail — no infinite supervisor loops

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly supervisor: SupervisorService,
    private readonly conversation: ConversationService,
    private readonly tracker: ChatTrackerSpecialist,
    private readonly graph: GraphService,
    private readonly skills: SkillRegistry,
  ) {}

  // ─── Single entry point: supervisor decides which SKILL to run ──────
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
      const decision = await this.supervisor.decide(
        userId,
        message,
        history,
        convo,
      );
      this.logger.log(`turn ${turn}: ${decision.next} — ${decision.reason}`);

      if (decision.next === 'FINISH') break;

      const skill = this.skills.get(decision.next);
      if (!skill) {
        // Supervisor guards against unknown/disabled skills, but stay safe.
        finalAnswer = `(skill "${decision.next}" is not available)`;
        break;
      }

      const ctx = this.skills.buildContext(
        decision.next,
        userId,
        message,
        convo,
        decision.parameters,
      );
      const result = await skill.execute(ctx);

      // Log what just happened so the supervisor knows next turn.
      finalAnswer = result.text;
      history.push(`${decision.next}: ${result.text}`);

      // Terminal skills (conversational reply or a fire-and-forget HITL
      // kickoff) complete the turn — re-routing would spawn duplicate work.
      const terminal = result.terminal ?? skill.manifest.terminal;
      if (terminal) break;
    }

    const answer = finalAnswer || '(no specialist produced an answer)';
    this.conversation.append(userId, 'assistant', answer);
    return answer;
  }

  async getMemory(userId: string) {
    return this.graph.getAll(userId);
  }
}
