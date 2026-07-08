import { SkillRegistry } from './skill.registry';
import { SkillApprovalService } from './skill.approval';
import { ManifestSchema, defineManifest } from './manifest.schema';
import { KnotSkill, SkillContext, SkillResult } from './skill.types';

function fakeSkill(
  manifestInput: Parameters<typeof defineManifest>[0],
  run: (ctx: SkillContext) => SkillResult = () => ({ text: 'ok' }),
): KnotSkill {
  return {
    manifest: defineManifest(manifestInput),
    execute: (ctx) => Promise.resolve(run(ctx)),
  };
}

/** Minimal SettingsService double — only disabledSkills is used by routing. */
function fakeSettings(disabled: string[] = []) {
  return {
    disabledSkills: jest.fn().mockResolvedValue(new Set(disabled)),
  } as any;
}

function makeRegistry(skills: KnotSkill[], disabled: string[] = []) {
  return new SkillRegistry(
    skills,
    fakeSettings(disabled),
    new SkillApprovalService(),
  );
}

describe('SkillRegistry', () => {
  const gmail = fakeSkill({
    name: 'gmail',
    version: '1.0.0',
    description: 'read gmail',
    tools: ['gmail.read'],
  });
  const compose = fakeSkill({
    name: 'compose',
    version: '1.0.0',
    description: 'send mail',
    sideEffects: true,
    terminal: true,
    tools: ['email.send'],
  });

  it('registers available skills and builds routing from manifests', async () => {
    const reg = makeRegistry([gmail, compose]);
    reg.onModuleInit();
    expect(reg.list()).toHaveLength(2);
    const section = await reg.routingSection('tg-1');
    expect(section).toContain('- gmail: read gmail');
    expect(section).toContain('- compose: send mail');
    expect(section).toContain('- FINISH:');
    // Never a hard-coded list — description text comes straight from manifests.
    expect(reg.get('gmail')).toBe(gmail);
  });

  it('disables a skill whose required env var is missing', async () => {
    delete process.env.SOME_REQUIRED_KEY;
    const gated = fakeSkill({
      name: 'gated',
      version: '1.0.0',
      description: 'needs a key',
      requiredEnv: ['SOME_REQUIRED_KEY'],
    });
    const reg = makeRegistry([gated]);
    reg.onModuleInit();
    expect(reg.get('gated')).toBeUndefined(); // not runnable
    expect(reg.list()[0].available).toBe(false);
    const section = await reg.routingSection('tg-1');
    expect(section).not.toContain('gated');
  });

  it('throws at registration if a read-only skill binds a send tool', () => {
    // Bypass defineManifest's authoring check to reach register()'s guard.
    const rogue: KnotSkill = {
      manifest: ManifestSchema.parse({
        name: 'rogue',
        version: '1.0.0',
        description: 'x',
        sideEffects: false,
        tools: ['email.send'],
      }),
      execute: () => Promise.resolve({ text: '' }),
    };
    const reg = makeRegistry([]);
    expect(() => reg.register(rogue)).toThrow(/side-effecting tool/);
  });

  it('excludes per-user disabled skills from routing', async () => {
    const reg = makeRegistry([gmail, compose], ['compose']);
    reg.onModuleInit();
    const section = await reg.routingSection('tg-1');
    expect(section).toContain('gmail');
    expect(section).not.toContain('send mail');
    const routable = await reg.routableNames('tg-1');
    expect(routable.has('gmail')).toBe(true);
    expect(routable.has('compose')).toBe(false);
  });

  it('gives read-only skills a denied approval factory', async () => {
    const reg = makeRegistry([gmail, compose]);
    reg.onModuleInit();
    const ro = reg.buildContext('gmail', 'tg-1', 'hi', '(no prior messages)');
    expect(ro.sideEffects).toBe(false);
    await expect(
      ro.approval.request('tg-1', { title: 't', body: 'b' }),
    ).rejects.toThrow(/may not/);

    const se = reg.buildContext('compose', 'tg-1', 'hi', '(no prior messages)');
    expect(se.sideEffects).toBe(true);
    // Side-effecting skills get the real approval service (does not throw).
    expect(typeof se.approval.request).toBe('function');
  });
});
