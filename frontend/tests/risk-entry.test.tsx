import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { expect, it } from 'vitest';
import { AppProviders } from '../src/app/AppProviders';
import { DemoRepository } from '../src/common/store/repository';
import S04RiskPage from '../src/pc/pages/S04RiskPage';
import { createIdentityHarness } from './identityHarness';

it('names the investigator, switches the global account and lets that investigator claim, fill and save directly', async () => {
  const repository = new DemoRepository();
  const identity = createIdentityHarness('EMP-004');
  const host = document.createElement('div');
  const root = createRoot(host);
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  try {
    await act(async () =>
      root.render(
        <identity.Provider>
          <AppProviders exposeAwcp={false} site={{ name: 'test', description: 'test' }} scopeKey="risk.entry">
            <S04RiskPage repository={repository} objectId="RALT-001" />
          </AppProviders>
        </identity.Provider>
      )
    );
    const guidance = host.querySelector('[aria-label="当前办理人和下一步"]');
    expect(guidance?.textContent).toContain('调查填报：刘洋');
    expect(guidance?.textContent).toContain('独立复核：赵敏');
    expect(guidance?.textContent).toContain('风险监控：周宁');
    expect(host.querySelector('[aria-label="调查分析"]')).toBeNull();
    const before = repository.snapshot();
    const switchUser = button('切换为 刘洋');
    expect(switchUser).toBeDefined();
    await act(async () => switchUser?.click());
    expect(repository.snapshot()).toEqual(before);
    const claim = button('领取并填写');
    expect(claim?.disabled).toBe(false);
    await act(async () => claim?.click());
    const analysis = host.querySelector<HTMLTextAreaElement>('[aria-label="调查分析"]');
    expect(analysis?.disabled).toBe(false);
    expect(button('领取并填写')).toBeUndefined();
    await act(async () => {
      if (!analysis) throw new Error('Missing editable form');
      analysis.value = '正在核对活动流水。';
      Simulate.change(analysis);
    });
    await act(async () => button('保存草稿')?.click());
    const saved = repository.snapshot().riskAlerts.find((alert) => alert.id === 'RALT-001');
    expect(saved).toMatchObject({
      assigneeId: 'EMP-005',
      status: 'investigating',
      businessVersion: 3,
      investigationDraft: { analysis: '正在核对活动流水。' }
    });
    const audit = repository.snapshot().auditEntries.filter((entry) => entry.entityId === 'RALT-001');
    expect(audit.map((entry) => entry.actorId)).toEqual(['EMP-005', 'EMP-005']);
    await identity.switchUser('EMP-006');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="调查分析"]')?.disabled).toBe(true);
    await act(async () => button('切换为 刘洋')?.click());
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="调查分析"]')?.value).toBe('正在核对活动流水。');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="调查分析"]')?.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});

it('keeps optional monitor assignment and records the actual assigning user', async () => {
  const repository = new DemoRepository();
  const identity = createIdentityHarness('EMP-006');
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <identity.Provider>
          <AppProviders exposeAwcp={false} site={{ name: 'test', description: 'test' }} scopeKey="risk.dispatch">
            <S04RiskPage repository={repository} objectId="RALT-001" />
          </AppProviders>
        </identity.Provider>
      )
    );
    const select = host.querySelector<HTMLSelectElement>('[aria-label="调查人"]');
    if (!select) throw new Error('Missing optional assignment');
    expect(select.closest('details')?.open).toBe(false);
    await act(async () => {
      select.value = 'EMP-005';
      Simulate.change(select);
    });
    const assign = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '分派调查');
    expect(assign?.disabled).toBe(false);
    await act(async () => assign?.click());
    expect(repository.snapshot().riskAlerts.find((alert) => alert.id === 'RALT-001')).toMatchObject({
      assigneeId: 'EMP-005',
      status: 'investigating'
    });
    expect(repository.snapshot().auditEntries.find((entry) => entry.entityId === 'RALT-001')?.actorId).toBe('EMP-006');
    expect(host.textContent).toContain('切换为 刘洋');
  } finally {
    await act(async () => root.unmount());
  }
});
