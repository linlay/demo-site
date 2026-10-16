import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import O08ApprovalPage from '../src/pc/pages/O08ApprovalPage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function render(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/O08');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-001');
  return {
    root,
    identity,
    element: (
      <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <O08ApprovalPage repository={repository} />
      </AppProviders></identity.Provider>
    )
  };
}

it('discovers all O08 actions through two Core manual levels and replays submit, review, withdraw and resubmit', async () => {
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
      'office.approval.read',
      'office.approval.submit',
      'office.approval.approve',
      'office.approval.return',
      'office.approval.withdraw'
    ];
    for (const action of actions) expect(index.sections.some((item) => item.section === action)).toBe(true);
    const example = (action: string): JsonObject => {
      const section = api.manual({ section: action, revision: index.revision }) as AwcpManualSection;
      const item = section.examples?.[0];
      if (!item) throw new Error(`Missing example: ${action}`);
      return item;
    };
    let count = 0;
    const invoke = async (action: string, args: JsonObject): Promise<AwcpActionResponse> => {
      let response: AwcpActionResponse | undefined;
      await act(async () => {
        response = await api.invoke({ action, args, requestId: `o08-awcp-${++count}`, revision: index.revision });
      });
      if (!response) throw new Error(`No response: ${action}`);
      return response;
    };
    expect(await invoke('office.approval.read', example('office.approval.read'))).toMatchObject({
      ok: true,
      result: { data: { requestId: 'APPR-001', status: 'submitted', taskId: 'APPTODO-001' } }
    });
    const before = repository.snapshot();
    expect(
      await invoke('office.approval.submit', {
        ...example('office.approval.submit'),
        materialIds: [],
        idempotencyKey: 'o08-no-materials'
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(
      await invoke('office.approval.approve', {
        ...example('office.approval.approve'),
        actorId: 'EMP-004',
        idempotencyKey: 'o08-wrong-reviewer'
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(before);
    expect(await invoke('office.approval.submit', example('office.approval.submit'))).toMatchObject({
      ok: true,
      result: { data: { requestId: 'APPR-004', taskId: 'APPTODO-004', status: 'submitted', businessVersion: 1 } }
    });
    expect(
      await invoke('office.approval.withdraw', {
        ...example('office.approval.withdraw'),
        requestId: 'APPR-004',
        idempotencyKey: 'o08-withdraw-new'
      })
    ).toMatchObject({
      ok: true,
      result: { data: { requestId: 'APPR-004', taskId: null, status: 'withdrawn', businessVersion: 2 } }
    });
    expect(
      await invoke('office.approval.submit', {
        ...example('office.approval.submit'),
        requestId: 'APPR-004',
        expectedVersion: 2,
        description: '补正后的虚构说明。',
        idempotencyKey: 'o08-resubmit-new'
      })
    ).toMatchObject({
      ok: true,
      result: { data: { requestId: 'APPR-004', taskId: 'APPTODO-005', status: 'submitted', businessVersion: 3 } }
    });
    expect(
      await invoke('office.approval.return', {
        ...example('office.approval.return'),
        requestId: 'APPR-004',
        expectedVersion: 3,
        idempotencyKey: 'o08-return-new'
      })
    ).toMatchObject({ ok: true, result: { data: { status: 'returned', businessVersion: 4 } } });
    expect(await invoke('office.approval.approve', example('office.approval.approve'))).toMatchObject({
      ok: true,
      result: { data: { requestId: 'APPR-001', status: 'approved', businessVersion: 2 } }
    });
    expect(
      await invoke('office.approval.withdraw', {
        ...example('office.approval.withdraw'),
        expectedVersion: 2,
        idempotencyKey: 'o08-terminal-withdraw'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(await invoke('office.approval.read', { requestId: 'APPR-004', actorId: 'EMP-001' })).toMatchObject({
      ok: true,
      result: {
        data: {
          tasks: [
            { taskId: 'APPTODO-004', status: 'done' },
            { taskId: 'APPTODO-005', status: 'done' }
          ],
          decisions: [
            { action: 'withdraw', businessVersion: 2 },
            { action: 'return', businessVersion: 4 }
          ]
        }
      }
    });
    expect(container.textContent).toContain('APPR-001');
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after workflow.');
    expect(after.revision).toBe(index.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('uses the shared approval service from page controls', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element, identity } = render(repository, container);
  try {
    await act(async () => root.render(element));
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!button) throw new Error(`Missing button: ${label}`);
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    const fill = async (id: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(id);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || !setter) throw new Error(`Missing input: ${id}`);
      await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    };
    await fill('#o08-withdraw-reason', '需要调整申请内容。');
    await click('撤回');
    expect(repository.snapshot().officeApprovalRequests[0]).toMatchObject({ status: 'withdrawn', businessVersion: 2 });
    expect(container.textContent).toContain('APDEC-003');
    await click('补正后重新提交');
    expect(repository.snapshot().officeApprovalRequests[0]).toMatchObject({
      status: 'submitted',
      businessVersion: 3,
      currentTaskId: 'APPTODO-004'
    });
    await identity.switchUser('EMP-002');
    await fill('#o08-opinion', '资料齐全，同意。');
    await click('通过');
    expect(repository.snapshot().officeApprovalRequests[0]).toMatchObject({ status: 'approved', businessVersion: 4 });
    expect(
      repository
        .snapshot()
        .officeApprovalDecisions.find((item) => item.requestId === 'APPR-001' && item.action === 'approve')
    ).toMatchObject({
      actorId: 'EMP-002',
      opinion: '资料齐全，同意。'
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
