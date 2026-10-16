import { createIdentityHarness } from './identityHarness';
import Ajv from 'ajv';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { expect, it } from 'vitest';
import { DemoRepository, DEMO_STORAGE_KEY, type DemoStorage } from '../src/common/store/repository';
import { TodoService } from '../src/pc/service/todoService';
import { ApprovalService } from '../src/pc/service/approvalService';
import { APPROVAL_REVIEW_SCHEMA } from '../src/common/awcp/approvalSchemas';
import { TODO_COMPLETE_SCHEMA } from '../src/common/awcp/todoSchemas';
import { AppProviders } from '../src/app/AppProviders';
import O01TodoPage from '../src/pc/pages/O01TodoPage';
import ApprovalCenterPage from '../src/pc/pages/ApprovalCenterPage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';
import { siteForRoute } from '../src/common/awcp/site';

class MemoryStorage implements DemoStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const actor = { actorId: 'EMP-002' };
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test control');
  return value;
}

it('seeds linked, schema-compatible records and preserves completion across reload and reset', () => {
  const storage = new MemoryStorage();
  const repository = new DemoRepository({ storage, workbenchSamples: true });
  const initial = repository.snapshot();
  const todo = new TodoService(repository);
  const approval = new ApprovalService(repository);
  expect(todo.query(actor).items).toHaveLength(18);
  expect(todo.history(actor)).toHaveLength(60);
  expect(
    initial.officeApprovalRequests.filter((row) => row.reviewerId === actor.actorId && row.status === 'submitted')
  ).toHaveLength(14);
  expect(
    new Set(initial.officeApprovalDecisions.filter((row) => row.actorId === actor.actorId).map((row) => row.requestId))
      .size
  ).toBe(45);
  const generated = required(initial.officeApprovalRequests.find((row) => row.id === 'APPR-100'));
  const input = {
    ...actor,
    requestId: generated.id,
    expectedVersion: 1,
    opinion: '资料完整，同意。',
    idempotencyKey: 'sample-review'
  };
  expect(new Ajv().compile(APPROVAL_REVIEW_SCHEMA)(input)).toBe(true);
  approval.approve(input);
  approval.approve(input);
  expect(todo.query(actor).items).toHaveLength(17);
  expect(todo.history(actor)).toHaveLength(61);
  expect(repository.snapshot().todos.find((row) => row.id === generated.currentTaskId)?.status).toBe('done');
  const formInput = { ...actor, todoId: 'TODO-100', expectedVersion: 1, idempotencyKey: 'sample-complete' };
  expect(new Ajv().compile(TODO_COMPLETE_SCHEMA)(formInput)).toBe(true);
  todo.complete(formInput);
  expect(todo.history(actor)).toHaveLength(62);
  const restored = new DemoRepository({ storage, workbenchSamples: true });
  expect(restored.snapshot()).toEqual(repository.snapshot());
  expect(new TodoService(restored).query({ actorId: 'EMP-003' }).items).toHaveLength(1);
  expect(new TodoService(restored).history({ actorId: 'EMP-003' })).toEqual([]);
  expect(restored.reset()).toEqual(initial);
});

it('upgrades existing storage once without overwriting user records or colliding with their IDs', () => {
  const storage = new MemoryStorage();
  const previous = new DemoRepository({ storage });
  previous.transact((draft) => {
    draft.officeApprovalRequests.push({
      ...draft.officeApprovalRequests[0],
      id: 'APPR-100',
      title: '保留的用户申请',
      currentTaskId: 'APPTODO-100'
    });
    draft.todos.push({ ...draft.todos[3], id: 'APPTODO-100', sourceId: 'APPR-100' });
    draft.forms[0].amountCents = 765432;
  });
  const upgraded = new DemoRepository({ storage, workbenchSamples: true });
  expect(upgraded.snapshot().officeApprovalRequests.find((row) => row.id === 'APPR-100')?.title).toBe('保留的用户申请');
  expect(upgraded.snapshot().forms[0].amountCents).toBe(765432);
  const snapshot = upgraded.snapshot();
  expect(new Set(snapshot.todos.map((row) => row.id)).size).toBe(snapshot.todos.length);
  for (const request of snapshot.officeApprovalRequests.filter((row) => row.currentTaskId)) {
    expect(snapshot.todos.find((row) => row.id === request.currentTaskId)?.sourceId).toBe(request.id);
  }
  upgraded.transact(() => undefined);
  expect(new DemoRepository({ storage, workbenchSamples: true }).snapshot()).toEqual(upgraded.snapshot());
  expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY) ?? '{}').workbenchSampleVersion).toBe(1);
});

it('paginates completed work, filters it, and resets the page on an actor change', async () => {
  const repository = new DemoRepository({ workbenchSamples: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-002');
  const route = resolveRoute('/');
  try {
    await act(async () =>
      root.render(
        <identity.Provider><AppProviders scopeKey={scopeKeyForRoute(route)} site={siteForRoute(route)}>
          <O01TodoPage repository={repository} navigate={() => undefined} />
        </AppProviders></identity.Provider>
      )
    );
    const done = required(container.querySelector<HTMLButtonElement>('#todo-tab-done'));
    await act(async () => done.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(20);
    const firstIds = container.querySelector('tbody')?.textContent;
    const next = required(
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '下一页')
    );
    await act(async () => next.click());
    expect(container.querySelector('tbody')?.textContent).not.toBe(firstIds);
    expect(container.textContent).toContain('2 / 3');
    const search = required(container.querySelector<HTMLInputElement>('input[type="search"]'));
    await act(async () =>
      Simulate.change(search, { target: { value: 'APPR-003' } } as unknown as Parameters<typeof Simulate.change>[1])
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('1 / 1');
    await identity.switchUser('EMP-003');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('OTODO-001');
    expect(container.textContent).not.toContain('APPR-003');
  } finally {
    await act(async () => root.unmount());
  }
});

it('paginates approval history and keeps batch selections on the current page', async () => {
  const repository = new DemoRepository({ workbenchSamples: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ApprovalCenterPage repository={repository} navigate={() => undefined} />));
    const done = required(
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) =>
        button.textContent?.includes('我的已办')
      )
    );
    await act(async () => done.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(20);
    const next = required(
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '下一页')
    );
    await act(async () => next.click());
    await act(async () => next.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(next.disabled).toBe(true);
    const pending = required(
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) =>
        button.textContent?.includes('我的待办')
      )
    );
    await act(async () => pending.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(14);
    expect(container.textContent).toContain('1 / 1');
    await act(async () => {
      const service = new ApprovalService(repository);
      for (let index = 0; index < 10; index += 1)
        service.submit({
          actorId: 'EMP-001',
          requestId: null,
          expectedVersion: null,
          title: `分页申请 ${index}`,
          description: '虚构测试申请',
          materialIds: ['APMAT-001'],
          idempotencyKey: `pagination-${index}`
        });
    });
    const selectPage = required(container.querySelector<HTMLInputElement>('thead input[type="checkbox"]'));
    await act(async () =>
      Simulate.change(selectPage, { target: { checked: true } } as unknown as Parameters<typeof Simulate.change>[1])
    );
    expect(container.querySelectorAll('tbody input:checked')).toHaveLength(20);
    await act(async () => next.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(container.querySelectorAll('tbody input:checked')).toHaveLength(0);
    expect(container.textContent).toContain('已选中 0 条');
  } finally {
    await act(async () => root.unmount());
  }
});
