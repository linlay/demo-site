import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';
import type { AwcpManualSection } from '@app/awcp';
import { CurrentUserProvider } from '../src/app/CurrentUser';
import { useCurrentUser } from '../src/app/currentUserContext';
import { AppProviders } from '../src/app/AppProviders';
import { AccountActions } from '../src/app/AccountActions';
import { SessionMenu } from '../src/pc/components/SessionMenu';
import { DemoRepository } from '../src/common/store/repository';
import S04RiskPage from '../src/pc/pages/S04RiskPage';

it('shows six accounts with three broad duties, opens a risk form directly and exposes working global account tools for AI', async () => {
  const repository = new DemoRepository({ workflowProfile: 'coarse-roles' });
  const state = repository.snapshot();
  function Scope() {
    const identity = useCurrentUser();
    return (
      <>
        <SessionMenu repository={repository} />
        <AppProviders key={identity?.actorId} site={{ name: 'test', description: 'test' }} scopeKey="two-account-test">
          <AccountActions />
          <S04RiskPage repository={repository} objectId="RALT-001" />
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
        <CurrentUserProvider initialActorId="EMP-001" employees={state.employees} departments={state.departments}>
          <Scope />
        </CurrentUserProvider>
      )
    );
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="调查分析"]')?.disabled).toBe(false);
    expect(host.textContent).not.toContain('领取并填写');
    const before = repository.snapshot();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开账户菜单"]')?.click());
    expect(document.querySelectorAll('[data-user-id]')).toHaveLength(6);
    expect(document.querySelector('[data-user-id="EMP-001"]')?.textContent).toContain('发起与办理');
    expect(document.querySelector('[data-user-id="EMP-002"]')?.textContent).toContain('审核');
    expect(document.querySelector('[data-user-id="EMP-006"]')?.textContent).toContain('数据分析');
    for (const id of ['EMP-001', 'EMP-003', 'EMP-005'])
      expect(document.querySelector(`[data-user-id="${id}"]`)?.textContent).toContain('发起与办理');
    for (const id of ['EMP-002', 'EMP-004'])
      expect(document.querySelector(`[data-user-id="${id}"]`)?.textContent).toContain('审核');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开账户菜单"]')?.click());
    const api = window.awcp;
    if (!api) throw new Error('Missing bridge');
    const manual = api.manual();
    if (!('sections' in manual)) throw new Error('Missing manual');
    const review = api.manual({ section: 'securities.alert.review', revision: manual.revision }) as AwcpManualSection;
    expect(review.examples?.[0].actorId).toBe('EMP-002');
    const read = await api.invoke({
      action: 'demo.account.read',
      args: {},
      requestId: 'read-accounts',
      revision: manual.revision
    });
    expect(read).toMatchObject({
      ok: true,
      result: { data: { currentActorId: 'EMP-001' } }
    });
    const denied = await api.invoke({
      action: 'securities.alert.review',
      args: review.examples?.[0] ?? {},
      requestId: 'wrong-current-user',
      revision: manual.revision
    });
    expect(denied).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    let switched: unknown;
    await act(async () => {
      switched = await api.invoke({
        action: 'demo.account.switch',
        args: { actorId: 'EMP-002' },
        requestId: 'switch-accounts',
        revision: manual.revision
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(switched).toMatchObject({ ok: true, result: { data: { actorId: 'EMP-002', refreshManual: true } } });
    expect(host.querySelector('[aria-label="打开账户菜单"]')?.textContent).toContain('陈明');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="调查分析"]')?.disabled).toBe(true);
    expect(repository.snapshot()).toEqual(before);
    const next = window.awcp?.manual();
    if (!next || !('sections' in next)) throw new Error('Missing switched manual');
    const account = await window.awcp?.invoke({
      action: 'demo.account.read',
      args: {},
      requestId: 'read-switched',
      revision: next.revision
    });
    expect(account).toMatchObject({ ok: true, result: { data: { currentActorId: 'EMP-002' } } });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
