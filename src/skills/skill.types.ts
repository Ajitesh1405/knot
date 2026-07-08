import { SkillManifest } from './manifest.schema';

/** Time-range hint extracted by the supervisor, mirrors RouteSchema. */
export type RouteParams = {
  timeRange?: 'today' | 'tomorrow' | 'this_week' | 'all' | 'unspecified';
  limit?: number;
};

/**
 * A generic approval card a skill can raise for a side effect it wants to
 * perform. Built-in skills (compose/scheduler) use their own established HITL
 * graphs; this factory is the path for NEW skills (MCP, reminders…) that need
 * an Approve/Edit/Cancel gate without hand-rolling one.
 */
export interface ApprovalCard {
  /** Short title, e.g. "Send email" or "Run MCP tool". */
  title: string;
  /** Human-readable body describing exactly what will happen. */
  body: string;
  /** Optional structured detail rendered as key: value lines. */
  detail?: Record<string, string>;
}

export type ApprovalDecision = 'approved' | 'cancelled' | 'expired';

export interface ApprovalCardFactory {
  /**
   * Present a card and resolve once the user decides (or it expires).
   * Denied at the type level for read-only skills — see SkillContext.sideEffects.
   */
  request(userId: string, card: ApprovalCard): Promise<ApprovalDecision>;
}

/** Everything a skill needs to do its job, handed in per invocation. */
export interface SkillContext {
  userId: string;
  message: string;
  /** Recent conversation text, or '(no prior messages)'. */
  conversation: string;
  /** Supervisor-extracted parameters. */
  params?: RouteParams;
  /** True when this skill's manifest allows side effects. */
  sideEffects: boolean;
  /** Approval-card factory for side-effecting skills. */
  approval: ApprovalCardFactory;
}

export interface SkillResult {
  /** Text to surface to the user (may be a HITL kickoff acknowledgement). */
  text: string;
  /**
   * When true, the supervisor loop stops after this skill. Defaults to the
   * skill manifest's `terminal` flag when omitted.
   */
  terminal?: boolean;
}

/** The interface every skill (built-in adapter or external) implements. */
export interface KnotSkill {
  readonly manifest: SkillManifest;
  execute(ctx: SkillContext): Promise<SkillResult>;
}

/** DI token collecting all skill providers contributed by a module. */
export const KNOT_SKILLS = Symbol('KNOT_SKILLS');
