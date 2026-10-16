import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import S04RiskPage from '../src/pc/pages/S04RiskPage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function render(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/S04');
  const root = createRoot(container);
  return {
    root,
    element: (
      <AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <S04RiskPage repository={repository} />
      </AppProviders>
    )
  };
}

it('discovers S04 through Core manual, invokes valid examples and rejects evidence, role and version failures', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element } = render(repository, container);
  try {
    await act(async () => root.render(element));
    const api = window.awcp;
    if (!api) throw new Error('AWCP bridge is missing.');
    const index = api.manual();
    if (!('sections' in index)) throw new Error('Expected manual index.');
    const actions = [
      'securities.alert.query',
      'securities.alert.read',
      'securities.alert.assign',
      'securities.alert.evidence.attach',
      'securities.investigation.record',
      'securities.alert.review',
      'securities.alert.close'
    ];
    for (const action of actions) expect(index.sections.some((item) => item.section === action)).toBe(true);
    const example = (action: string): JsonObject => {
      const section = api.manual({ section: action, revision: index.revision }) as AwcpManualSection;
      if (!section.examples?.[0]) throw new Error(`Missing example: ${action}`);
      return section.examples[0];
    };
    let count = 0;
    const invoke = async (action: string, args: JsonObject): Promise<AwcpActionResponse> => {
      let response: AwcpActionResponse | undefined;
      await act(async () => {
        response = await api.invoke({ action, args, requestId: `s04-${++count}`, revision: index.revision });
      });
      if (!response) throw new Error(`No response: ${action}`);
      return response;
    };
    expect(await invoke('securities.alert.query', example('securities.alert.query'))).toMatchObject({
      ok: true,
      result: { data: { totalCount: 5 } }
    });
    expect(await invoke('securities.alert.read', example('securities.alert.read'))).toMatchObject({
      ok: true,
      result: { data: { rule: { version: 1, threshold: 3 }, evidence: [expect.anything(), expect.anything()] } }
    });
    const before = repository.snapshot();
    expect(
      await invoke('securities.alert.assign', {
        ...example('securities.alert.assign'),
        assigneeId: 'EMP-001',
        idempotencyKey: 'bad-assignee'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(
      await invoke('securities.alert.evidence.attach', {
        ...example('securities.alert.evidence.attach'),
        evidenceId: 'REVD-011',
        idempotencyKey: 'bad-evidence'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(
      await invoke('securities.investigation.record', {
        ...example('securities.investigation.record'),
        actorId: 'EMP-001',
        idempotencyKey: 'bad-investigator'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(
      await invoke('securities.alert.review', {
        ...example('securities.alert.review'),
        actorId: 'EMP-005',
        idempotencyKey: 'bad-reviewer'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(
      await invoke('securities.alert.close', {
        ...example('securities.alert.close'),
        expectedVersion: 3,
        idempotencyKey: 'stale-close'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(repository.snapshot()).toEqual(before);
    for (const action of actions.slice(2)) expect(await invoke(action, example(action))).toMatchObject({ ok: true });
    expect(repository.snapshot().riskAlerts.find((item) => item.id === 'RALT-004')?.status).toBe('escalated');
    expect(repository.snapshot().riskAlerts.some((item) => item.id === 'RALT-001')).toBe(true);
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after actions.');
    expect(after.revision).toBe(index.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps unclaimed alerts focused on the next step instead of displaying a disabled form', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element } = render(repository, container);
  try {
    await act(async () => root.render(element));
    const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    expect(button('分派调查')?.disabled).toBe(true);
    expect(container.textContent).toContain('刘洋');
    expect(container.textContent).toContain('周宁');
    expect(container.textContent).not.toContain('请先由监控员分派调查');
    expect(container.querySelector('[aria-label="调查分析"]')).toBeNull();
    expect(button('登记调查')).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
