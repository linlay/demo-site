import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import S02ResearchPage from '../src/pc/pages/S02ResearchPage';
import { ResearchService } from '../src/pc/service/researchService';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function renderPage(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/S02');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-003');
  return {
    root,
    switchUser: identity.switchUser,
    element: (
      <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <S02ResearchPage repository={repository} />
      </AppProviders></identity.Provider>
    )
  };
}

it('discovers S02 through Core manual and replays blocked, publication and return recovery branches', async () => {
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
      'securities.research.read',
      'securities.research.patch',
      'securities.research.check',
      'securities.research.submit-review',
      'securities.research.review',
      'securities.research.publish',
      'securities.research.archive'
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
      'securities.research.check',
      { ...example('securities.research.check'), reportId: 'REPORT-002', idempotencyKey: 's02-awcp-missing' },
      's02-missing'
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(initial);
    await act(async () => {
      response = await invoke('securities.research.check', example('securities.research.check'), 's02-check');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { passed: true, documentVersion: 1 } } });
    await act(async () => {
      response = await invoke(
        'securities.research.submit-review',
        example('securities.research.submit-review'),
        's02-submit'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'quality-review', businessVersion: 2 } } });
    const beforeWrongRole = repository.snapshot();
    response = await invoke(
      'securities.research.review',
      { ...example('securities.research.review'), actorId: 'EMP-006', idempotencyKey: 's02-wrong-role' },
      's02-wrong-role'
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(beforeWrongRole);
    await act(async () => {
      response = await invoke('securities.research.review', example('securities.research.review'), 's02-quality');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'compliance-review', businessVersion: 3 } } });
    await act(async () => {
      response = await invoke('securities.research.review', example('securities.research.review', 1), 's02-compliance');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'approved', businessVersion: 4 } } });
    await act(async () => {
      response = await invoke('securities.research.publish', example('securities.research.publish'), 's02-publish');
    });
    expect(response).toMatchObject({
      ok: true,
      result: { data: { status: 'published', publicationId: 'PUB-001', scope: 'clients' } }
    });
    await act(async () => {
      response = await invoke('securities.research.archive', example('securities.research.archive'), 's02-archive');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'archived', businessVersion: 6 } } });
    expect(repository.snapshot().researchPublications).toHaveLength(1);

    await act(async () => {
      response = await invoke(
        'securities.research.check',
        { ...example('securities.research.check'), reportId: 'REPORT-003', idempotencyKey: 's02-check-003' },
        's02-check-003'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { documentVersion: 1 } } });
    await act(async () => {
      response = await invoke(
        'securities.research.submit-review',
        { ...example('securities.research.submit-review'), reportId: 'REPORT-003', idempotencyKey: 's02-submit-003' },
        's02-submit-003'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'quality-review' } } });
    await act(async () => {
      response = await invoke('securities.research.review', example('securities.research.review', 2), 's02-return-003');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'returned', businessVersion: 3 } } });
    await act(async () => {
      response = await invoke(
        'securities.research.patch',
        {
          ...example('securities.research.patch'),
          reportId: 'REPORT-003',
          expectedVersion: 3,
          title: '虚构主题修订报告第二版',
          idempotencyKey: 's02-patch-003'
        },
        's02-patch-003'
      );
    });
    expect(response).toMatchObject({
      ok: true,
      result: { data: { status: 'draft', businessVersion: 4, documentVersion: 2 } }
    });
    const afterPatch = repository.snapshot();
    response = await invoke(
      'securities.research.submit-review',
      {
        ...example('securities.research.submit-review'),
        reportId: 'REPORT-003',
        expectedVersion: 4,
        idempotencyKey: 's02-submit-too-early'
      },
      's02-submit-too-early'
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(afterPatch);
    await act(async () => {
      response = await invoke(
        'securities.research.check',
        {
          ...example('securities.research.check'),
          reportId: 'REPORT-003',
          expectedVersion: 4,
          idempotencyKey: 's02-check-003-v2'
        },
        's02-check-003-v2'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { documentVersion: 2 } } });
    await act(async () => {
      response = await invoke(
        'securities.research.submit-review',
        {
          ...example('securities.research.submit-review'),
          reportId: 'REPORT-003',
          expectedVersion: 4,
          idempotencyKey: 's02-submit-003-v2'
        },
        's02-submit-003-v2'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'quality-review', businessVersion: 5 } } });
    await act(async () => {
      response = await invoke(
        'securities.research.review',
        {
          ...example('securities.research.review'),
          reportId: 'REPORT-003',
          expectedVersion: 5,
          idempotencyKey: 's02-quality-003-v2'
        },
        's02-quality-003-v2'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'compliance-review', businessVersion: 6 } } });
    await act(async () => {
      response = await invoke(
        'securities.research.review',
        {
          ...example('securities.research.review', 1),
          reportId: 'REPORT-003',
          expectedVersion: 6,
          idempotencyKey: 's02-compliance-003-v2'
        },
        's02-compliance-003-v2'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'approved', businessVersion: 7 } } });
    await act(async () => {
      response = await invoke(
        'securities.research.publish',
        {
          ...example('securities.research.publish'),
          reportId: 'REPORT-003',
          expectedVersion: 7,
          idempotencyKey: 's02-publish-003-v2'
        },
        's02-publish-003-v2'
      );
    });
    expect(response).toMatchObject({
      ok: true,
      result: { data: { status: 'published', documentVersion: 2, publicationId: 'PUB-002' } }
    });
    const read = await invoke(
      'securities.research.read',
      { ...example('securities.research.read'), reportId: 'REPORT-003' },
      's02-read-003'
    );
    expect(read).toMatchObject({
      ok: true,
      result: {
        data: {
          status: 'published',
          reviews: expect.arrayContaining([
            expect.objectContaining({ stage: 'quality', decision: 'return', documentVersion: 1 })
          ])
        }
      }
    });
    await act(async () => {
      expect(new ResearchService(repository).create({ actorId: 'EMP-003', topicTitle: '新建虚构研究课题', idempotencyKey: 's02-create-test' })).toMatchObject({ reportId: 'REPORT-004', status: 'draft' });
    });
    await act(async () => {
      response = await invoke('securities.research.patch', example('securities.research.patch'), 's02-patch-002');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { reportId: 'REPORT-002', documentVersion: 2 } } });
    expect(repository.snapshot().researchReports.some((item) => item.id === 'REPORT-003')).toBe(true);
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after workflow.');
    expect(after.revision).toBe(manual.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('uses the same research service from page controls', async () => {
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
    const actor = switchUser;
    await click('检查引用与披露');
    await click('提交审阅');
    await actor('EMP-005');
    await click('审阅批准');
    await actor('EMP-006');
    await click('审阅批准');
    await actor('EMP-007');
    await click('模拟发布');
    await click('归档');
    expect(repository.snapshot().researchReports.find((item) => item.id === 'REPORT-001')?.status).toBe('archived');
    expect(container.textContent).toContain('REPORT-001 · archived · 业务版本 6');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
