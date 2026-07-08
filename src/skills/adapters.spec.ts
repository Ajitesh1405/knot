import { GmailSkill } from './gmail/skill.service';
import { CalendarSkill } from './calendar/skill.service';
import { composeManifest } from './compose/skill.manifest';
import { schedulerManifest } from './scheduler/skill.manifest';
import { SkillContext } from './skill.types';

// NOTE: compose/scheduler *services* pull in @langchain/langgraph (ESM) which
// ts-jest can't transform, so we assert their manifest contract here and cover
// their runtime delegation via the registry/e2e paths instead.

const baseCtx = (over: Partial<SkillContext> = {}): SkillContext => ({
  userId: 'tg-1',
  message: 'hi',
  conversation: '(no prior messages)',
  sideEffects: false,
  approval: { request: jest.fn() },
  ...over,
});

describe('GmailSkill adapter', () => {
  it('coerces tomorrow → all before calling the specialist', async () => {
    const gmail = { run: jest.fn().mockResolvedValue('mails') } as any;
    const res = await new GmailSkill(gmail).execute(
      baseCtx({ params: { timeRange: 'tomorrow' } }),
    );
    expect(gmail.run).toHaveBeenCalledWith('tg-1', 'hi', { timeRange: 'all' });
    expect(res.text).toBe('mails');
  });

  it('passes other ranges through untouched', async () => {
    const gmail = { run: jest.fn().mockResolvedValue('x') } as any;
    await new GmailSkill(gmail).execute(
      baseCtx({ params: { timeRange: 'this_week' } }),
    );
    expect(gmail.run).toHaveBeenCalledWith('tg-1', 'hi', {
      timeRange: 'this_week',
    });
  });
});

describe('CalendarSkill adapter', () => {
  it('coerces all → this_week (calendar has no all bucket)', async () => {
    const cal = { run: jest.fn().mockResolvedValue('events') } as any;
    await new CalendarSkill(cal).execute(
      baseCtx({ params: { timeRange: 'all' } }),
    );
    expect(cal.run).toHaveBeenCalledWith('tg-1', 'hi', {
      timeRange: 'this_week',
    });
  });
});

describe('side-effecting skill manifests', () => {
  it('compose is side-effecting, terminal, and binds send tools', () => {
    expect(composeManifest.sideEffects).toBe(true);
    expect(composeManifest.terminal).toBe(true);
    expect(composeManifest.tools).toEqual(
      expect.arrayContaining(['email.send']),
    );
  });

  it('scheduler is side-effecting, terminal, and binds invite tools', () => {
    expect(schedulerManifest.sideEffects).toBe(true);
    expect(schedulerManifest.terminal).toBe(true);
    expect(schedulerManifest.tools).toEqual(
      expect.arrayContaining(['meeting.schedule']),
    );
  });
});
