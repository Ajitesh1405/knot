import { firstValueFrom } from 'rxjs';
import { SkillApprovalService } from './skill.approval';

describe('SkillApprovalService', () => {
  it('emits a request event and resolves on the matching decision', async () => {
    const svc = new SkillApprovalService();
    const eventPromise = firstValueFrom(svc.events$);

    const decisionPromise = svc.request('tg-1', {
      title: 'Run tool',
      body: 'do the thing',
    });

    const event = await eventPromise;
    expect(event.userId).toBe('tg-1');
    expect(event.card.title).toBe('Run tool');

    expect(svc.resolve(event.requestId, 'approved')).toBe(true);
    await expect(decisionPromise).resolves.toBe('approved');
  });

  it('returns false when resolving an unknown request', () => {
    const svc = new SkillApprovalService();
    expect(svc.resolve('nope', 'approved')).toBe(false);
  });

  it('expires after the configured timeout', async () => {
    const prev = process.env.SKILL_APPROVAL_TIMEOUT_MS;
    process.env.SKILL_APPROVAL_TIMEOUT_MS = '10';
    try {
      const svc = new SkillApprovalService();
      const decision = await svc.request('tg-1', { title: 't', body: 'b' });
      expect(decision).toBe('expired');
    } finally {
      process.env.SKILL_APPROVAL_TIMEOUT_MS = prev;
    }
  });
});
