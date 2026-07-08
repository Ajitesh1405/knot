import { z } from 'zod';

/**
 * Tools that produce external side effects (send mail, create invites…).
 * A skill whose manifest declares `sideEffects: false` is FORBIDDEN from
 * declaring any of these — the registry throws at boot if it tries, so the
 * denial is structural (boot-time), not merely a convention.
 */
export const SIDE_EFFECT_TOOLS = [
  'email.send',
  'email.reply',
  'meeting.schedule',
  'calendar.invite',
] as const;
export type SideEffectTool = (typeof SIDE_EFFECT_TOOLS)[number];

export function isSideEffectTool(tool: string): tool is SideEffectTool {
  return (SIDE_EFFECT_TOOLS as readonly string[]).includes(tool);
}

/**
 * The declarative contract every skill ships with. The supervisor's routing
 * prompt is built entirely from these — there is no hard-coded specialist list.
 */
export const ManifestSchema = z.object({
  /** kebab/snake identifier used as the routing key (e.g. "gmail"). */
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'name must be lower_snake_case'),
  /** One or two sentences — injected verbatim into the routing prompt. */
  description: z.string().min(1),
  /** Semver-ish string, shown in /skills. */
  version: z.string().min(1),
  /** Env vars that MUST be present, else the skill is skipped at boot. */
  requiredEnv: z.array(z.string()).default([]),
  /** OAuth scopes the skill needs (informational for now). */
  requiredScopes: z.array(z.string()).default([]),
  /**
   * If true, every external write MUST route through the HITL approval
   * mechanism. If false, the skill is denied side-effecting tools at boot.
   */
  sideEffects: z.boolean().default(false),
  /** Tool identifiers this skill is allowed to bind. */
  tools: z.array(z.string()).default([]),
  /**
   * When true, running this skill completes the turn (no further supervisor
   * re-routing). Conversational replies and fire-and-forget HITL kickoffs
   * (chat, compose, scheduler) are terminal.
   */
  terminal: z.boolean().default(false),
  /** Skills that ship in the box vs. loaded from KNOT_SKILLS_DIR. */
  source: z.enum(['builtin', 'external']).default('builtin'),
});

export type SkillManifest = z.infer<typeof ManifestSchema>;

/** Convenience for authoring a manifest with validation at module load. */
export function defineManifest(
  input: z.input<typeof ManifestSchema>,
): SkillManifest {
  const manifest = ManifestSchema.parse(input);
  assertToolPolicy(manifest);
  return manifest;
}

/**
 * The DI-level security rule: a read-only skill (sideEffects=false) may not
 * declare any side-effecting tool. Throws — callers use this at boot so a
 * misconfigured skill fails fast rather than silently gaining send access.
 */
export function assertToolPolicy(manifest: SkillManifest): void {
  if (manifest.sideEffects) return;
  const forbidden = manifest.tools.filter(isSideEffectTool);
  if (forbidden.length > 0) {
    throw new Error(
      `Skill "${manifest.name}" declares sideEffects:false but binds ` +
        `side-effecting tool(s): ${forbidden.join(', ')}. ` +
        `Set sideEffects:true (and route through HITL) or drop these tools.`,
    );
  }
}
