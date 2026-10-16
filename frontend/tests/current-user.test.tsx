import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { DemoApi } from '@app/api';
import { AppProviders } from '../src/app/AppProviders';
import { CurrentUserProvider } from '../src/app/CurrentUser';
import { useCurrentUser } from '../src/app/currentUserContext';
import { DemoSessionContext } from '../src/app/demoSessionContext';
import { createSeedState } from '../src/common/fixtures/seed';
import { SessionMenu } from '../src/pc/components/SessionMenu';
import ServerBusinessPage from '../src/pc/pages/ServerBusinessPage';
import BusinessScenePage from '../src/pc/pages/BusinessScenePage';
import { DemoRepository } from '../src/common/store/repository';
import { findScenario } from '../src/common/scenarios/catalog';

const seed = createSeedState();
it('switches the account once for approvals and workbench without per-page identity selectors', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const input = JSON.parse(String(init?.body ?? '{}')) as { actorId?: string };
    const op = String(url);
    const result =
      op.includes('approval_templates_list') || op.includes('approval_materials_list')
        ? []
        : op.includes('workbench_summary')
          ? { pending: input.actorId === 'EMP-002' ? 3 : 1, done: 0, overdue: 0, revision: 0 }
          : { items: [], total: 0, page: 1, pageSize: 20, generation: 'g1', revision: 0 };
    return new Response(JSON.stringify(result), { status: 200 });
  });
  const api = new DemoApi(fetcher);
  const session = {
    id: 'identity-test',
    generation: 'g1',
    seed: 1,
    datasetVersion: 'test',
    profile: 'acceptance' as const,
    simulatedAt: '',
    expiresAt: '',
    recordCount: 48,
    employees: seed.employees,
    departments: seed.departments
  };
  api.adoptSession(session);
  function Pages() {
    const [scene, setScene] = useState<'O08' | 'O01'>('O08');
    const user = useCurrentUser();
    return (
      <>
        <SessionMenu repository={new DemoRepository()} />
        <button onClick={() => setScene('O01')}>进入工作台</button>
        <AppProviders
          key={`${scene}:${user?.actorId}`}
          site={{ name: 'test', description: 'test' }}
          scopeKey={`test.${scene}`}
        >
          <ServerBusinessPage scene={scene} navigate={() => undefined} />
        </AppProviders>
      </>
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <DemoSessionContext.Provider
          value={{ session, api, reset: async () => undefined, refresh: async () => undefined }}
        >
          <CurrentUserProvider employees={seed.employees} departments={seed.departments}>
            <Pages />
          </CurrentUserProvider>
        </DemoSessionContext.Provider>
      )
    );
    expect(host.querySelector('select')?.textContent).not.toContain('陈明');
    const account = host.querySelector<HTMLButtonElement>('[aria-label="打开账户菜单"]');
    expect(account?.textContent).toContain('陈明');
    await act(async () => account?.click());
    const choices = document.querySelectorAll('[data-user-id]');
    expect(choices).toHaveLength(10);
    expect(document.querySelector('[data-user-id="EMP-001"]')?.textContent).toContain('客户经理');
    expect(document.querySelector('[data-user-id="EMP-004"]')?.textContent).toContain('客户复核');
    expect(document.querySelector('[data-user-id="EMP-003"]')?.textContent).toContain('研究分析');
    await act(async () => document.querySelector<HTMLElement>('[data-user-id="EMP-003"]')?.click());
    expect(host.querySelector('[aria-label="打开账户菜单"]')?.textContent).toContain('王晨');
    await act(async () =>
      [...host.querySelectorAll('button')].find((button) => button.textContent === '进入工作台')?.click()
    );
    const requests = fetcher.mock.calls
      .filter(([url]) => /approval_center_query|todos_query|workbench_summary/.test(String(url)))
      .map(([, init]) => JSON.parse(String(init?.body)) as { actorId: string });
    expect(requests.some((input) => input.actorId === 'EMP-003')).toBe(true);
    expect(requests.at(-1)?.actorId).toBe('EMP-003');
    expect(host.querySelector('h1')).toBeNull();
    expect(host.textContent).not.toContain('集中查看待办事项与办理记录。');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it('persists the selected identity, ignores URL hints and rejects inactive cross-tab selections', async () => {
  const key = 'test.current-user';
  const old = window.location.href;
  localStorage.setItem(key, 'EMP-003');
  window.history.replaceState(null, '', '/scenes/O08?actor=EMP-001');
  function Account() {
    return <span>{useCurrentUser()?.actorId}</span>;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <CurrentUserProvider employees={seed.employees} storageKey={key}>
          <Account />
        </CurrentUserProvider>
      )
    );
    expect(host.textContent).toBe('EMP-003');
    expect(window.location.search).toBe('');
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'EMP-012' })));
    expect(host.textContent).toBe('EMP-003');
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'EMP-001' })));
    expect(host.textContent).toBe('EMP-001');
    expect(localStorage.getItem(key)).toBe('EMP-001');
    await act(async () =>
      root.render(
        <CurrentUserProvider key="reload" employees={seed.employees} storageKey={key}>
          <Account />
        </CurrentUserProvider>
      )
    );
    expect(host.textContent).toBe('EMP-001');
  } finally {
    await act(async () => root.unmount());
    localStorage.removeItem(key);
    window.history.replaceState(null, '', old);
  }
});
it('starts a business list with its working controls instead of a duplicate page hero', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const scenario = findScenario('S01');
  if (!scenario) throw new Error('Missing scenario');
  try {
    await act(async () =>
      root.render(
        <BusinessScenePage scenario={scenario} repository={new DemoRepository()} navigate={() => undefined} />
      )
    );
    expect(host.querySelector('h1')).toBeNull();
    expect(host.textContent).not.toContain('选择已有事项查看业务内容');
    expect(host.textContent).toContain('嘉和实业');
  } finally {
    await act(async () => root.unmount());
  }
});
