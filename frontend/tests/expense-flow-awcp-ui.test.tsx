import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import B06WorkspacePage from '../src/pc/pages/B06WorkspacePage';
import { ExpenseService } from '../src/pc/service/expenseService';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

it('replays the complete expense loop through Core manual, section and invoke', async () => {
  const repository = new DemoRepository();
  new ExpenseService(repository).check({ actorId: 'EMP-001', travelFormId: 'FORM-001', receipts: [{ invoiceNo: 'DEMO-HOTEL-002', assetId: 'AST-004', amountCents: 50000 }], lineItems: [{ category: 'hotel', invoiceNo: 'DEMO-HOTEL-002', amountCents: 50000 }], declaredTotalCents: 50000, idempotencyKey: 'flow-seed' });
  const route = resolveRoute('/scenes/O09/objects/FORM-003');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-001');

  try {
    await act(async () =>
      root.render(
        <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
          <B06WorkspacePage repository={repository} objectId="FORM-003" />
        </AppProviders></identity.Provider>
      )
    );
    const api = window.awcp;
    if (!api) throw new Error('AWCP bridge is missing.');
    const manual = api.manual();
    if (!('sections' in manual)) throw new Error('Expected manual index.');
    const actions = [
      'office.expense.submit',
      'office.expense.review',
      'office.expense.correct',
      'office.expense.read'
    ];
    for (const action of actions) expect(manual.sections.some((item) => item.section === action)).toBe(true);
    const example = (action: string, index = 0): JsonObject => {
      const current = api.manual();
      if (!('sections' in current)) throw new Error('Current manual index missing.');
      const section = api.manual({ section: action, revision: current.revision }) as AwcpManualSection;
      const value = section.examples?.[index];
      if (!value) throw new Error(`Missing example for ${action}`);
      return value;
    };
    const invoke = (action: string, args: JsonObject, requestId: string) => {
      const current = api.manual();
      if (!('sections' in current)) throw new Error('Current manual index missing.');
      return api.invoke({
        action,
        args,
        revision: current.revision,
        requestId
      });
    };
    let response: AwcpActionResponse | undefined;

    expect(repository.snapshot().expenseClaims.find((item) => item.formId === 'FORM-003')).toBeDefined();
    const read = await invoke('office.expense.read', example('office.expense.read'), 'flow-read-draft');
    expect(read).toMatchObject({ ok: true, result: { data: { status: 'draft', businessVersion: 1 } } });

    await act(async () => {
      response = await invoke('office.expense.submit', example('office.expense.submit'), 'flow-submit');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'submitted', businessVersion: 2 } } });
    expect(repository.snapshot().todos.find((item) => item.sourceId === 'FORM-003')?.assigneeId).toBe('EMP-002');
    await act(async () => {
      response = await invoke('office.expense.review', { expenseFormId: 'FORM-003', actorId: 'EMP-002', expectedVersion: 2, decision: 'return', reason: '请补正票据金额', idempotencyKey: 'flow-return' }, 'flow-return');
    });
    expect(response, JSON.stringify(response)).toMatchObject({ ok: true, result: { data: { status: 'returned', businessVersion: 3 } } });
    expect(
      repository.snapshot().auditEntries.find((item) => item.entityId === 'FORM-003' && item.action === 'return')?.note
    ).toBe('请补正票据金额');

    const beforeInvalid = repository.snapshot();
    const early = await invoke(
      'office.expense.submit',
      {
        ...example('office.expense.submit'),
        expectedVersion: 3,
        idempotencyKey: 'flow-too-early'
      },
      'flow-early-resubmit'
    );
    expect(early).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', details: { executionStarted: false } }
    });
    expect(repository.snapshot()).toEqual(beforeInvalid);

    await act(async () => {
      response = await invoke('office.expense.correct', example('office.expense.correct'), 'flow-correct');
    });
    expect(response).toMatchObject({
      ok: true,
      result: { data: { status: 'returned', businessVersion: 4, declaredTotalCents: 51000 } }
    });
    await act(async () => {
      response = await invoke(
        'office.expense.submit',
        {
          ...example('office.expense.submit'),
          expectedVersion: 4,
          idempotencyKey: 'flow-resubmit'
        },
        'flow-resubmit'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'submitted', businessVersion: 5 } } });
    await act(async () => {
      response = await invoke(
        'office.expense.review',
        {
          expenseFormId: 'FORM-003', actorId: 'EMP-002', decision: 'approve', reason: '',
          expectedVersion: 5,
          idempotencyKey: 'flow-approve-after-return'
        },
        'flow-approve'
      );
    });
    expect(response).toMatchObject({ ok: true, result: { data: { status: 'approved', businessVersion: 6 } } });

    const progress = await invoke('office.expense.read', example('office.expense.read'), 'flow-read-final');
    expect(progress).toMatchObject({
      ok: true,
      result: {
        data: {
          status: 'approved',
          declaredTotalCents: 51000,
          history: expect.arrayContaining([expect.objectContaining({ action: 'return', note: '请补正票据金额' })])
        }
      }
    });
    expect(repository.snapshot().forms.find((item) => item.id === 'FORM-003')?.status).toBe('approved');
    expect(container.textContent).toContain('FORM-003 · approved · 版本 6');
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after workflow.');
    expect(after.sections.some((item) => item.section === 'office.expense.read')).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('uses the same expense workflow service from the page controls', async () => {
  const repository = new DemoRepository();
  new ExpenseService(repository).check({ actorId: 'EMP-001', travelFormId: 'FORM-001', receipts: [{ invoiceNo: 'DEMO-TRAIN-001', assetId: 'AST-003', amountCents: 30000 }], lineItems: [{ category: 'transport', invoiceNo: 'DEMO-TRAIN-001', amountCents: 30000 }], declaredTotalCents: 30000, idempotencyKey: 'flow-ui-seed' });
  const route = resolveRoute('/scenes/O09/objects/FORM-003');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-001');

  try {
    await act(async () =>
      root.render(
        <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
          <B06WorkspacePage repository={repository} objectId="FORM-003" />
        </AppProviders></identity.Provider>
      )
    );
    const panel = container.querySelector<HTMLElement>('section[aria-labelledby="expense-flow-title"]');
    if (!panel) throw new Error('Expense workflow panel is missing.');
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!button) throw new Error(`Missing button: ${label}`);
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    const changeActor = identity.switchUser;

    await click('提交 / 重新提交');
    expect(repository.snapshot().forms.find((item) => item.id === 'FORM-003')?.status).toBe('submitted');
    await changeActor('EMP-002');
    const reason = container.querySelector<HTMLInputElement>('#expense-flow-reason');
    const reasonSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!reason || !reasonSetter) throw new Error('Return reason input is missing.');
    await act(async () => { reasonSetter.call(reason, '请补正票据金额'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('主管退回');
    expect(repository.snapshot().forms.find((item) => item.id === 'FORM-003')?.status).toBe('returned');
    await changeActor('EMP-001');
    const amount = container.querySelector<HTMLInputElement>('#expense-flow-correction-amount');
    if (!amount) throw new Error('Correction amount input is missing.');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Input setter is missing.');
      setter.call(amount, '31000');
      amount.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('补正并重新校验');
    expect(repository.snapshot().expenseClaims.find((item) => item.formId === 'FORM-003')?.declaredTotalCents).toBe(
      31000
    );
    await click('提交 / 重新提交');
    await changeActor('EMP-002');
    await click('主管批准');
    await click('查询进度');
    expect(repository.snapshot().forms.find((item) => item.id === 'FORM-003')?.status).toBe('approved');
    expect(container.querySelector('section[aria-labelledby="expense-flow-title"]')?.textContent).toContain('FORM-003 · approved · 版本 6');
    expect(container.querySelector('section[aria-labelledby="expense-flow-title"]')?.textContent).toContain('expense-correct');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
