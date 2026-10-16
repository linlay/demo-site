import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import S03IbProjectPage from '../src/pc/pages/S03IbProjectPage';
import { IbProjectService } from '../src/pc/service/ibProjectService';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function render(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/S03');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-008');
  return {
    root,
    switchUser: identity.switchUser,
    element: (
      <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <S03IbProjectPage repository={repository} />
      </AppProviders></identity.Provider>
    )
  };
}

it('discovers S03 through both manual levels and invokes normal, blocked and return paths', async () => {
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
      'securities.ib-project.read',
      'securities.ib-project.submit',
      'securities.diligence.assign',
      'securities.diligence.attach',
      'securities.finding.resolve',
      'securities.quality.submit',
      'securities.ib-project.review',
      'securities.ib-project.archive'
    ];
    for (const action of actions) expect(index.sections.some((item) => item.section === action)).toBe(true);
    const example = (action: string, number = 0): JsonObject => {
      const section = api.manual({ section: action, revision: index.revision }) as AwcpManualSection;
      const item = section.examples?.[number];
      if (!item) throw new Error(`Missing example: ${action}`);
      return item;
    };
    let counter = 0;
    const invoke = async (action: string, args: JsonObject): Promise<AwcpActionResponse> => {
      let response: AwcpActionResponse | undefined;
      await act(async () => {
        response = await api.invoke({ action, args, requestId: `s03-awcp-${++counter}`, revision: index.revision });
      });
      if (!response) throw new Error(`No response: ${action}`);
      return response;
    };
    const quality = 'securities.quality.submit';
    const review = 'securities.ib-project.review';
    const before = repository.snapshot();
    expect(
      await invoke(quality, { ...example(quality), projectId: 'IBP-002', idempotencyKey: 's03-blocked-awcp' })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(repository.snapshot()).toEqual(before);
    expect(await invoke(quality, example(quality))).toMatchObject({
      ok: true,
      result: { data: { status: 'quality-review', policyVersion: 1 } }
    });
    const wrong = repository.snapshot();
    expect(
      await invoke(review, { ...example(review), actorId: 'EMP-004', idempotencyKey: 's03-wrong-reviewer' })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(repository.snapshot()).toEqual(wrong);
    expect(await invoke(review, example(review))).toMatchObject({
      ok: true,
      result: { data: { status: 'committee-review' } }
    });
    expect(await invoke(review, example(review, 1))).toMatchObject({
      ok: true,
      result: { data: { status: 'approved' } }
    });
    expect(await invoke('securities.ib-project.archive', example('securities.ib-project.archive'))).toMatchObject({
      ok: true,
      result: { data: { status: 'archived' } }
    });
    expect(await invoke('securities.diligence.assign', example('securities.diligence.assign'))).toMatchObject({
      ok: true,
      result: { data: { status: 'diligence' } }
    });
    expect(await invoke('securities.diligence.attach', example('securities.diligence.attach'))).toMatchObject({
      ok: true,
      result: { data: { workpaperVersion: 1 } }
    });
    expect(await invoke('securities.finding.resolve', example('securities.finding.resolve'))).toMatchObject({
      ok: true,
      result: { data: { findingStatus: 'resolved' } }
    });
    expect(
      await invoke(quality, {
        ...example(quality),
        projectId: 'IBP-002',
        expectedVersion: 4,
        idempotencyKey: 's03-fixed-quality'
      })
    ).toMatchObject({ ok: true, result: { data: { status: 'quality-review' } } });

    expect(
      await invoke(quality, { ...example(quality), projectId: 'IBP-003', idempotencyKey: 's03-third-quality' })
    ).toMatchObject({ ok: true, result: { data: { status: 'quality-review' } } });
    expect(await invoke(review, example(review, 2))).toMatchObject({
      ok: true,
      result: { data: { status: 'returned' } }
    });
    const returned = repository
      .snapshot()
      .ibFindings.find((item) => item.projectId === 'IBP-003' && item.status === 'open');
    if (!returned) throw new Error('Returned finding is missing.');
    expect(
      await invoke('securities.diligence.attach', {
        ...example('securities.diligence.attach'),
        projectId: 'IBP-003',
        expectedVersion: 3,
        kind: 'financial',
        assetId: 'IBAST-007',
        idempotencyKey: 's03-attach-revision-awcp'
      })
    ).toMatchObject({ ok: true, result: { data: { workpaperVersion: 2 } } });
    expect(
      await invoke('securities.finding.resolve', {
        ...example('securities.finding.resolve'),
        projectId: 'IBP-003',
        expectedVersion: 4,
        findingId: returned.id,
        idempotencyKey: 's03-resolve-return-awcp'
      })
    ).toMatchObject({ ok: true });
    expect(
      await invoke(quality, {
        ...example(quality),
        projectId: 'IBP-003',
        expectedVersion: 5,
        idempotencyKey: 's03-resubmit-awcp'
      })
    ).toMatchObject({ ok: true, result: { data: { status: 'quality-review' } } });
    expect(
      await invoke('securities.ib-project.read', { ...example('securities.ib-project.read'), projectId: 'IBP-003' })
    ).toMatchObject({
      ok: true,
      result: {
        data: {
          findings: [expect.objectContaining({ status: 'resolved' })],
          workpapers: expect.arrayContaining([expect.objectContaining({ kind: 'financial', version: 2 })])
        }
      }
    });
    await act(async () => {
      expect(new IbProjectService(repository).create({ actorId: 'EMP-008', issuerId: 'ISS-001', title: '新建虚构投行项目', idempotencyKey: 's03-create-test' })).toMatchObject({ projectId: 'IBP-004' });
    });
    expect(await invoke('securities.ib-project.submit', example('securities.ib-project.submit'))).toMatchObject({
      ok: true,
      result: { data: { status: 'initiated' } }
    });
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after operations.');
    expect(after.revision).toBe(index.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('uses the same project service from page controls', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element, switchUser } = render(repository, container);
  try {
    await act(async () => root.render(element));
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!button) throw new Error(`Missing button: ${label}`);
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    const actor = switchUser;
    await click('提交质控');
    await actor('EMP-010');
    await click('审议批准');
    await actor('EMP-004');
    await click('审议批准');
    await actor('EMP-008');
    await click('归档');
    expect(repository.snapshot().ibProjects.find((item) => item.id === 'IBP-001')?.status).toBe('archived');
    expect(container.textContent).toContain('IBP-001 · archived · 业务版本 5');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
