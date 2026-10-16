import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import S01ClientPage from '../src/pc/pages/S01ClientPage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function renderPage(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/S01');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-001');
  return {
    root,
    switchUser: identity.switchUser,
    element: (
      <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <S01ClientPage repository={repository} />
      </AppProviders></identity.Provider>
    )
  };
}

it('replays blocked, returned and archived S01 branches through Core two-level manual', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element } = renderPage(repository, container);
  try {
    await act(async () => root.render(element));
    const api = window.awcp;
    if (!api) throw new Error('AWCP bridge is missing.');
    const manual = api.manual();
    if (!('sections' in manual)) throw new Error('Expected manual index.');
    const actions = [
      'securities.client.read',
      'securities.client.patch',
      'securities.suitability.evaluate',
      'securities.suitability.match',
      'securities.review.submit',
      'securities.review.decide',
      'securities.client.archive'
    ];
    for (const action of actions) expect(manual.sections.some((item) => item.section === action)).toBe(true);
    const example = (action: string, index = 0): JsonObject => {
      const section = api.manual({ section: action, revision: manual.revision }) as AwcpManualSection;
      const result = section.examples?.[index];
      if (!result) throw new Error(`Missing example for ${action}`);
      return result;
    };
    const invoke = (action: string, args: JsonObject, requestId: string) =>
      api.invoke({ action, args, requestId, revision: manual.revision });
    let response: AwcpActionResponse | undefined;

    const initial = repository.snapshot();
    response = await invoke(
      'securities.suitability.evaluate',
      { ...example('securities.suitability.evaluate'), clientId: 'CLI-002', idempotencyKey: 's01-missing-awcp' },
      's01-missing'
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(initial);
    response = await invoke(
      'securities.suitability.evaluate',
      { ...example('securities.suitability.evaluate'), clientId: 'CLI-003', idempotencyKey: 's01-expired-awcp' },
      's01-expired'
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(initial);

    await act(async () => {
      response = await invoke(
        'securities.suitability.evaluate',
        example('securities.suitability.evaluate'),
        's01-evaluate'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { riskLevel: 3, policyVersion: 1 } } });
    await act(async () => {
      response = await invoke(
        'securities.suitability.match',
        { ...example('securities.suitability.match'), productId: 'PRD-002', idempotencyKey: 's01-risky-awcp' },
        's01-risky'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { eligible: false } } });
    const beforeMismatch = repository.snapshot();
    response = await invoke('securities.review.submit', example('securities.review.submit'), 's01-too-early');
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(beforeMismatch);

    await act(async () => {
      response = await invoke('securities.suitability.match', example('securities.suitability.match'), 's01-match');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { eligible: true } } });
    await act(async () => {
      response = await invoke('securities.review.submit', example('securities.review.submit'), 's01-submit');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'submitted', businessVersion: 2 } } });
    await act(async () => {
      response = await invoke('securities.review.decide', example('securities.review.decide', 1), 's01-return');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'returned', businessVersion: 3 } } });
    await act(async () => {
      response = await invoke(
        'securities.client.patch',
        {
          ...example('securities.client.patch'),
          clientId: 'CLI-001',
          expectedVersion: 3,
          contactPhone: '13800000009',
          idempotencyKey: 's01-patch-return-awcp'
        },
        's01-patch-return'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'draft', businessVersion: 4 } } });
    await act(async () => {
      response = await invoke(
        'securities.suitability.evaluate',
        {
          ...example('securities.suitability.evaluate'),
          expectedVersion: 4,
          idempotencyKey: 's01-evaluate-again-awcp'
        },
        's01-evaluate-again'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { businessVersion: 4 } } });
    await act(async () => {
      response = await invoke(
        'securities.suitability.match',
        { ...example('securities.suitability.match'), expectedVersion: 4, idempotencyKey: 's01-match-again-awcp' },
        's01-match-again'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { eligible: true } } });
    await act(async () => {
      response = await invoke(
        'securities.review.submit',
        { ...example('securities.review.submit'), expectedVersion: 4, idempotencyKey: 's01-submit-again-awcp' },
        's01-submit-again'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'submitted', businessVersion: 5 } } });
    await act(async () => {
      response = await invoke(
        'securities.review.decide',
        { ...example('securities.review.decide'), expectedVersion: 5, idempotencyKey: 's01-approve-awcp' },
        's01-approve'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'approved', businessVersion: 6 } } });
    await act(async () => {
      response = await invoke(
        'securities.client.archive',
        { ...example('securities.client.archive'), expectedVersion: 6, idempotencyKey: 's01-archive-awcp' },
        's01-archive'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'archived', businessVersion: 7 } } });
    response = await invoke('securities.client.read', example('securities.client.read'), 's01-read-final');
    expect(response).toMatchObject({
      ok: true,
      result: { data: { status: 'archived', reviews: [{ status: 'returned' }, { status: 'approved' }] } }
    });
    expect(
      repository
        .snapshot()
        .todos.filter((item) => item.sourceId === 'CLI-001')
        .map((item) => item.status)
    ).toEqual(['done', 'done']);
    expect(container.textContent).toContain('CLI-001 · archived · 版本 7');
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after changes.');
    expect(after.revision).toBe(manual.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shares S01 service state with the page controls', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element, switchUser } = renderPage(repository, container);
  try {
    await act(async () => root.render(element));
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!button) throw new Error(`Missing button: ${label}`);
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    const reviewer = () => switchUser('EMP-004');
    await click('风险评估');
    const product = container.querySelector<HTMLSelectElement>('#s01-product');
    if (!product) throw new Error('Product selector is missing.');
    await act(async () => {
      product.value = 'PRD-001';
      product.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('匹配产品');
    await click('提交复核');
    await reviewer();
    await click('复核批准');
    await click('归档');
    expect(repository.snapshot().clientCases.find((item) => item.clientId === 'CLI-001')?.status).toBe('archived');
    expect(container.textContent).toContain('CLI-001 · archived · 版本 4');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
