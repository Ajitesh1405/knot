import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';
import { SkillApprovalService } from './skill.approval';
import {
  ApprovalCardFactory,
  ApprovalDecision,
  KnotSkill,
  KNOT_SKILLS,
  RouteParams,
  SkillContext,
} from './skill.types';
import {
  assertToolPolicy,
  ManifestSchema,
  SkillManifest,
} from './manifest.schema';

/** A skill plus the boot-time verdict on whether it can run. */
export interface RegisteredSkill {
  skill: KnotSkill;
  manifest: SkillManifest;
  /** false when a required env var is missing — kept for /skills visibility. */
  available: boolean;
  /** why it is unavailable, if so. */
  reason?: string;
}

/** Read-only skills get this — any side-effect request throws, by design. */
class DeniedApprovalFactory implements ApprovalCardFactory {
  constructor(private readonly skillName: string) {}
  request(): Promise<ApprovalDecision> {
    return Promise.reject(
      new Error(
        `Skill "${this.skillName}" declares sideEffects:false and may not ` +
          `request approvals or perform external writes.`,
      ),
    );
  }
}

@Injectable()
export class SkillRegistry implements OnModuleInit {
  private readonly logger = new Logger(SkillRegistry.name);
  private readonly registry = new Map<string, RegisteredSkill>();

  constructor(
    @Optional() @Inject(KNOT_SKILLS) private readonly skills: KnotSkill[] = [],
    private readonly settings: SettingsService,
    private readonly approvalSvc: SkillApprovalService,
  ) {}

  onModuleInit() {
    for (const skill of this.skills ?? []) this.register(skill);
    this.loadExternalSkills();
    const active = [...this.registry.values()].filter((r) => r.available);
    this.logger.log(
      `Loaded ${this.registry.size} skill(s), ${active.length} active: ` +
        active.map((r) => r.manifest.name).join(', '),
    );
  }

  /** Validate, env-gate, and enforce the tool policy for one skill. */
  register(skill: KnotSkill): void {
    // Re-validate even for built-ins so external skills go through the same gate.
    const manifest = ManifestSchema.parse(skill.manifest);
    assertToolPolicy(manifest); // throws at boot on a read-only skill w/ send tools

    if (this.registry.has(manifest.name)) {
      this.logger.warn(`Duplicate skill "${manifest.name}" ignored`);
      return;
    }

    const missing = manifest.requiredEnv.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      this.logger.warn(
        `Skill "${manifest.name}" disabled — missing env: ${missing.join(', ')}`,
      );
      this.registry.set(manifest.name, {
        skill,
        manifest,
        available: false,
        reason: `missing env: ${missing.join(', ')}`,
      });
      return;
    }

    this.registry.set(manifest.name, { skill, manifest, available: true });
  }

  /** Discover manifest-only external skills from KNOT_SKILLS_DIR. */
  private loadExternalSkills(): void {
    const dir = process.env.KNOT_SKILLS_DIR;
    if (!dir) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      this.logger.warn(`KNOT_SKILLS_DIR "${dir}" unreadable: ${String(err)}`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(dir, entry.name, 'skill.manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<
          string,
          unknown
        >;
        const manifest = ManifestSchema.parse({ ...raw, source: 'external' });
        assertToolPolicy(manifest);
        const name = manifest.name;
        this.register({
          manifest,
          execute: () =>
            Promise.resolve({
              text:
                `⚙️ External skill "${name}" is registered for routing but ` +
                `has no runtime attached in this build. See docs/SKILLS.md.`,
              terminal: true,
            }),
        });
      } catch (err) {
        this.logger.warn(
          `External skill in "${entry.name}" invalid: ${String(err)}`,
        );
      }
    }
  }

  /** All registered skills (available or not) — for /skills. */
  list(): RegisteredSkill[] {
    return [...this.registry.values()];
  }

  get(name: string): KnotSkill | undefined {
    const r = this.registry.get(name);
    return r?.available ? r.skill : undefined;
  }

  getManifest(name: string): SkillManifest | undefined {
    return this.registry.get(name)?.manifest;
  }

  isRegistered(name: string): boolean {
    return this.registry.has(name);
  }

  /** Skills a given user can currently route to (available AND not disabled). */
  private async activeFor(userId: string): Promise<RegisteredSkill[]> {
    const disabled = await this.settings.disabledSkills(userId);
    return [...this.registry.values()].filter(
      (r) => r.available && !disabled.has(r.manifest.name),
    );
  }

  /**
   * The dynamically-built specialist section of the supervisor prompt for a
   * given user. Routing is NEVER a hard-coded list — it derives from manifests.
   */
  async routingSection(userId: string): Promise<string> {
    const active = await this.activeFor(userId);
    const lines = active
      .map((r) => `- ${r.manifest.name}: ${r.manifest.description}`)
      .join('\n');
    return (
      lines +
      '\n- FINISH: the request has already been handled by a specialist this turn.'
    );
  }

  /** Names a user may route to right now (for post-hoc validation). */
  async routableNames(userId: string): Promise<Set<string>> {
    const active = await this.activeFor(userId);
    return new Set(active.map((r) => r.manifest.name));
  }

  /** Build the per-invocation context, wiring the correct approval factory. */
  buildContext(
    name: string,
    userId: string,
    message: string,
    conversation: string,
    params?: RouteParams,
  ): SkillContext {
    const manifest = this.getManifest(name);
    const sideEffects = manifest?.sideEffects ?? false;
    return {
      userId,
      message,
      conversation,
      params,
      sideEffects,
      approval: sideEffects
        ? this.approvalSvc
        : new DeniedApprovalFactory(name),
    };
  }
}
