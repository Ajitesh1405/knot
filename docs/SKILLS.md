# Knot Skills System

Knot's specialists are **skills**: self-describing, pluggable units the
supervisor routes to. There is **no hard-coded specialist list** anymore — the
routing prompt is assembled at request time from the manifests of the skills
that are registered, available (their env is present), and enabled for that
user.

This document explains the architecture and walks through authoring a new
skill end-to-end (a `reminders` skill).

---

## Concepts

| Piece | Where | Job |
|-------|-------|-----|
| **Manifest** | `skill.manifest.ts` | Declares name, description (routing text), version, required env/scopes, `sideEffects`, `terminal`, and allowed `tools`. Validated with zod. |
| **Skill service** | `skill.service.ts` | A NestJS `@Injectable()` implementing `KnotSkill` — `execute(ctx)` does the work. |
| **`SkillRegistry`** | `src/skills/skill.registry.ts` | Validates manifests, env-gates, enforces the tool-security policy, and builds the routing prompt per user. |
| **`SkillContext`** | passed into `execute` | `userId`, `message`, `conversation`, supervisor `params`, `sideEffects`, and an `approval` factory. |
| **`SkillApprovalService`** | `src/skills/skill.approval.ts` | Transport-agnostic HITL gate for skills that need Approve/Cancel without hand-rolling a LangGraph. |

### The security model (why `sideEffects` matters)

Every manifest declares `sideEffects: boolean`.

- `sideEffects: false` (read-only) — the registry **refuses at boot** to register
  the skill if it declares any side-effecting tool (`email.send`, `email.reply`,
  `meeting.schedule`, `calendar.invite`). This is enforced in
  `assertToolPolicy()` — it throws, so a misconfigured skill fails fast rather
  than silently gaining send access.
- At runtime, a read-only skill's `ctx.approval` is a `DeniedApprovalFactory`
  whose `request()` **rejects**. So even if a read-only skill tries to raise an
  approval card to perform a write, it cannot.
- `sideEffects: true` — the skill gets the real `SkillApprovalService` and MUST
  route every external write through an Approve/Edit/Cancel card. Knot never
  auto-sends.

### Per-user enable/disable

Each user can toggle skills with `/skills enable <name>` / `/skills disable <name>`.
State lives in the `SkillSetting` Prisma table (absence of a row = enabled).
Disabled skills are dropped from that user's routing prompt AND rejected at
dispatch, so a disabled skill is genuinely unreachable for that user.

---

## Authoring a skill: `reminders`

Goal: natural-language reminders ("remind me to pay rent every 1st at 9am").
This skill has a side effect (it creates a scheduled job), so it is
`sideEffects: true` and routes confirmation through an approval card.

> This is the worked example the Phase 4 `reminders` skill will flesh out; the
> shape below is complete and compiles against the current interfaces.

### 1. Manifest — `src/skills/reminders/skill.manifest.ts`

```ts
import { defineManifest } from '../manifest.schema';

export const remindersManifest = defineManifest({
  name: 'reminders',
  version: '1.0.0',
  description:
    'CREATE, list, or cancel reminders ("remind me to pay rent every 1st at ' +
    '9am", "remind me in 2 hours"). Pick this when the user wants to be ' +
    'nudged later.',
  // Creating a scheduled job is a side effect → confirm via an approval card.
  sideEffects: true,
  tools: ['reminder.create', 'reminder.cancel'],
  // Optional: skip loading unless a scheduler backend is configured.
  requiredEnv: [],
});
```

`defineManifest` validates the shape and runs `assertToolPolicy` immediately, so
authoring mistakes surface at module load.

### 2. Service — `src/skills/reminders/skill.service.ts`

```ts
import { Injectable } from '@nestjs/common';
import { KnotSkill, SkillContext, SkillResult } from '../skill.types';
import { remindersManifest } from './skill.manifest';
// import { RemindersService } from '../../reminders/reminders.service';

@Injectable()
export class RemindersSkill implements KnotSkill {
  readonly manifest = remindersManifest;

  // constructor(private readonly reminders: RemindersService) {}

  async execute(ctx: SkillContext): Promise<SkillResult> {
    // 1. Parse the NL request with the fast model into an RRULE-ish structure.
    // const parsed = await this.reminders.parse(ctx.message);

    // 2. Because this skill has side effects, confirm before persisting:
    const decision = await ctx.approval.request(ctx.userId, {
      title: 'Create reminder',
      body: `I'll remind you: "pay rent" every 1st at 9:00am.`,
      detail: { when: 'monthly, 1st, 09:00', text: 'pay rent' },
    });

    if (decision !== 'approved') {
      return { text: 'Okay, no reminder set.' };
    }

    // 3. Persist + schedule (scoped to ctx.userId for isolation).
    // await this.reminders.create(ctx.userId, parsed);
    return { text: '⏰ Reminder set: pay rent, monthly on the 1st at 9:00am.' };
  }
}
```

A read-only skill instead declares `sideEffects: false`, omits any
side-effecting tool, and never calls `ctx.approval.request` (it would reject).

### 3. Register it

Add the class to the built-in providers so NestJS instantiates it and the
registry picks it up:

```ts
// src/skills/builtin-skills.provider.ts
import { RemindersSkill } from './reminders/skill.service';

export const BUILTIN_SKILL_PROVIDERS = [
  /* …existing… */
  RemindersSkill,
];
```

That's it. Routing updates itself from the new manifest — no supervisor edit
needed. `/skills` will list it, and it obeys per-user enable/disable.

---

## External skills (`KNOT_SKILLS_DIR`)

Set `KNOT_SKILLS_DIR=/path/to/skills`. Each subdirectory with a
`skill.manifest.json` is validated (same zod schema, same tool-security policy)
and registered so it appears in routing and `/skills`. External skills are
manifest-only in this build (no runtime is dynamically loaded); attach a runtime
by adding the skill as a built-in provider as above, or extend the loader.

Example `KNOT_SKILLS_DIR/weather/skill.manifest.json`:

```json
{
  "name": "weather",
  "version": "0.1.0",
  "description": "answer weather questions for a city",
  "sideEffects": false,
  "tools": ["http.get"]
}
```

---

## Testing a skill

See `src/skills/*.spec.ts`. The registry, manifest policy, approval service, and
adapter coercions are all unit-tested. For a new skill, assert:

- the manifest validates (`defineManifest` doesn't throw);
- a read-only skill with a send tool **does** throw (`assertToolPolicy`);
- `execute` delegates/behaves as expected with a mocked dependency.
