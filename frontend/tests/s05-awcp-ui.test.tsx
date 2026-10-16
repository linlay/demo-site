import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import S05InstitutionPage from '../src/pc/pages/S05InstitutionPage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function mount(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/S05');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-001');
  return {
    root,
    identity,
    element: (
      <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <S05InstitutionPage repository={repository} />
      </AppProviders></identity.Provider>
    )
  };
}

it('replays the complete S05 flow through Core manual and rejects unsafe inputs before writing', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element } = mount(repository, container);
  try {
    await act(async () => root.render(element));
    const api = window.awcp;
    if (!api) throw new Error('AWCP bridge is missing.');
    const index = api.manual();
    if (!('sections' in index)) throw new Error('Expected manual index.');
    const actions = [
      'securities.institution.query',
      'securities.service.entitlement-check',
      'securities.service.need.revise',
      'securities.roadshow.reserve',
      'securities.material-package.create',
      'securities.roadshow.invite',
      'securities.roadshow.minutes.record',
      'securities.service.followup',
      'securities.service.summary'
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
        response = await api.invoke({ action, args, requestId: `s05-${++count}`, revision: index.revision });
      });
      if (!response) throw new Error(`No response: ${action}`);
      return response;
    };
    expect(await invoke(actions[0], example(actions[0]))).toMatchObject({
      ok: true,
      result: { data: { profile: { id: 'INST-001' } } }
    });
    expect(await invoke(actions[1], example(actions[1]))).toMatchObject({
      ok: true,
      result: { data: { eligible: true, policyVersion: 1 } }
    });
    const before = repository.snapshot();
    const conflict = await invoke(actions[3], {
      ...example(actions[3]),
      startAt: '2026-09-19T02:00:00.000Z',
      endAt: '2026-09-19T03:00:00.000Z',
      idempotencyKey: 's05-conflict'
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(
      await invoke(actions[3], { ...example(actions[3]), actorId: 'EMP-001', idempotencyKey: 's05-wrong-role' })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(
      await invoke(actions[4], {
        ...example(actions[4]),
        materialIds: ['SMAT-002'],
        idempotencyKey: 's05-outside-scope'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(repository.snapshot()).toEqual(before);
    expect(await invoke(actions[2], example(actions[2]))).toMatchObject({ ok: true });
    expect(await invoke(actions[3], example(actions[3]))).toMatchObject({
      ok: true,
      result: { data: { businessVersion: 2 } }
    });
    expect(await invoke(actions[4], example(actions[4]))).toMatchObject({
      ok: true,
      result: { data: { businessVersion: 3 } }
    });
    expect(await invoke(actions[5], example(actions[5]))).toMatchObject({
      ok: true,
      result: { data: { businessVersion: 4 } }
    });
    expect(await invoke(actions[6], example(actions[6]))).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments' }
    });
    repository.clock.advanceBy(30 * 3_600_000);
    expect(await invoke(actions[6], example(actions[6]))).toMatchObject({
      ok: true,
      result: { data: { businessVersion: 5 } }
    });
    expect(await invoke(actions[7], example(actions[7]))).toMatchObject({
      ok: true,
      result: { data: { businessVersion: 6 } }
    });
    expect(await invoke(actions[8], example(actions[8]))).toMatchObject({
      ok: true,
      result: { data: { completedNeeds: 1 } }
    });
    expect(repository.snapshot().roadshowInvitations[0].status).toBe('simulated');
    expect(repository.snapshot().mailSendRecords).toHaveLength(0);
    expect(container.textContent).toContain('MTG-004');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('operates the same S05 service through page controls', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element, identity } = mount(repository, container);
  try {
    await act(async () => root.render(element));
    const choose = async (label: string, value: string) => {
      const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (!select || !setter) throw new Error(`Missing select ${label}`);
      await act(async () => {
        setter.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    const fill = async (label: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || !setter) throw new Error(`Missing input ${label}`);
      await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    };
    await identity.switchUser( 'EMP-002');
    await choose('会议室', 'ROOM-001');
    await fill('路演开始', '2026-09-20T12:00');
    await fill('路演结束', '2026-09-20T13:00');
    await click('预约路演');
    expect(repository.snapshot().roadshows).toHaveLength(1);
    await identity.switchUser( 'EMP-003');
    await click('制作资料包');
    await identity.switchUser( 'EMP-002');
    await click('模拟邀请');
    expect(repository.snapshot().institutionNeeds[0].status, container.textContent ?? '').toBe('invited');
    await click('推进演示时钟到会议结束');
    await fill('议程', '虚构研究路演交流。');
    await fill('决定', '记录机构后续研究服务需求。');
    await click('登记纪要');
    await identity.switchUser( 'EMP-001');
    await fill('回访内容', '虚构机构确认已收到演示资料。');
    await choose('回访结果', 'satisfied');
    await click('登记回访');
    expect(repository.snapshot().institutionNeeds[0].status).toBe('completed');
    expect(container.textContent).toContain('SFUP-001');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
