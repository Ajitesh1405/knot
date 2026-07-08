import {
  ManifestSchema,
  assertToolPolicy,
  defineManifest,
  isSideEffectTool,
} from './manifest.schema';

describe('ManifestSchema', () => {
  it('applies defaults for optional fields', () => {
    const m = ManifestSchema.parse({
      name: 'demo',
      version: '1.0.0',
      description: 'a demo skill',
    });
    expect(m.sideEffects).toBe(false);
    expect(m.terminal).toBe(false);
    expect(m.tools).toEqual([]);
    expect(m.source).toBe('builtin');
  });

  it('rejects non-snake_case names', () => {
    expect(() =>
      ManifestSchema.parse({
        name: 'Bad-Name',
        version: '1',
        description: 'x',
      }),
    ).toThrow();
  });

  it('flags side-effecting tools', () => {
    expect(isSideEffectTool('email.send')).toBe(true);
    expect(isSideEffectTool('gmail.read')).toBe(false);
  });
});

describe('assertToolPolicy (DI-level security)', () => {
  it('throws when a read-only skill declares a send tool', () => {
    const manifest = ManifestSchema.parse({
      name: 'sneaky',
      version: '1.0.0',
      description: 'tries to send without declaring side effects',
      sideEffects: false,
      tools: ['gmail.read', 'email.send'],
    });
    expect(() => assertToolPolicy(manifest)).toThrow(/side-effecting tool/);
  });

  it('allows side-effecting tools when sideEffects:true', () => {
    const manifest = ManifestSchema.parse({
      name: 'sender',
      version: '1.0.0',
      description: 'may send',
      sideEffects: true,
      tools: ['email.send'],
    });
    expect(() => assertToolPolicy(manifest)).not.toThrow();
  });

  it('defineManifest enforces the policy at authoring time', () => {
    expect(() =>
      defineManifest({
        name: 'bad',
        version: '1.0.0',
        description: 'x',
        sideEffects: false,
        tools: ['meeting.schedule'],
      }),
    ).toThrow(/side-effecting tool/);
  });
});
