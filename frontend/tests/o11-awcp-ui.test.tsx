import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import O11ProcurementPage from '../src/pc/pages/O11ProcurementPage';
import { ProcurementService } from '../src/pc/service/procurementService';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function render(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/O11');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-001');
  return {
    root,
    identity,
    element: (
      <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <O11ProcurementPage repository={repository} />
      </AppProviders></identity.Provider>
    )
  };
}

it('discovers all O11 contracts through both Core manual levels and replays success plus failures', async () => {
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
      'office.procurement.read',
      'office.procurement.compare',
      'office.supplier.review',
      'office.receipt.accept'
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
        response = await api.invoke({ action, args, requestId: `o11-awcp-${++count}`, revision: index.revision });
      });
      if (!response) throw new Error(`No response: ${action}`);
      return response;
    };
    expect(await invoke('office.procurement.read', example('office.procurement.read'))).toMatchObject({
      ok: true,
      result: { data: { requests: expect.arrayContaining([expect.objectContaining({ id: 'PREQ-001' })]) } }
    });
    const before = repository.snapshot();
    expect(
      await invoke('office.procurement.compare', {
        ...example('office.procurement.compare'),
        quotes: [
          { supplierId: 'SUP-001', unitPriceCents: 800 },
          { supplierId: 'SUP-003', unitPriceCents: 700 }
        ],
        idempotencyKey: 'o11-pending'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(
      await invoke('office.supplier.review', {
        ...example('office.supplier.review'),
        proofIds: [],
        idempotencyKey: 'o11-no-proofs'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(
      await invoke('office.receipt.accept', {
        ...example('office.receipt.accept'),
        quantity: 5,
        idempotencyKey: 'o11-excess'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(repository.snapshot()).toEqual(before);
    await act(async () => {
      expect(new ProcurementService(repository).create({ actorId: 'EMP-001', itemName: '虚构办公鼠标', quantity: 3, idempotencyKey: 'o11-create-test' })).toMatchObject({ id: 'PREQ-003', status: 'draft' });
    });
    expect(await invoke('office.procurement.compare', example('office.procurement.compare'))).toMatchObject({
      ok: true,
      result: { data: { id: 'PCMP-002', status: 'selected' } }
    });
    expect(await invoke('office.supplier.review', example('office.supplier.review'))).toMatchObject({
      ok: true,
      result: { data: { id: 'SREV-001', status: 'approved' } }
    });
    expect(await invoke('office.receipt.accept', example('office.receipt.accept'))).toMatchObject({
      ok: true,
      result: { data: { id: 'PREC-001', status: 'accepted' } }
    });
    expect(repository.snapshot().inventoryEntries[0].totalCents).toBe(2400);
    expect(container.textContent).toContain('PREQ-003');
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after actions.');
    expect(after.revision).toBe(index.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shares purchase, comparison, review and receipt records between page controls and service', async () => {
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
    const select = async (selector: string, value: string) => {
      const element = container.querySelector<HTMLSelectElement>(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (!element || !setter) throw new Error(`Missing selector: ${selector}`);
      await act(async () => {
        setter.call(element, value);
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    const input = async (selector: string, value: string) => {
      const element = container.querySelector<HTMLInputElement>(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!element || !setter) throw new Error(`Missing input: ${selector}`);
      await act(async () => {
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await act(async () => { new ProcurementService(repository).create({ actorId: 'EMP-001', itemName: '虚构办公鼠标', quantity: 3, idempotencyKey: 'o11-create-page-test' }); });
    expect(repository.snapshot().purchaseRequests).toHaveLength(3);
    await select('#o11-request', 'PREQ-001');
    await select('[aria-label="报价供应商1"]', 'SUP-001');
    await select('[aria-label="报价供应商2"]', 'SUP-002');
    await input('[aria-label="报价单价1"]', '800');
    await input('[aria-label="报价单价2"]', '900');
    await click('完成比价');
    expect(repository.snapshot().purchaseComparisons).toHaveLength(2);
    await identity.switchUser( 'EMP-004');
    await select('#o11-supplier', 'SUP-003');
    await select('[aria-label="审核决定"]', 'approved');
    await input('[aria-label="审核意见"]', '虚构证明齐全且在有效期内。');
    await click('审核供应商');
    expect(repository.snapshot().supplierReviews).toHaveLength(1);
    await identity.switchUser( 'EMP-001');
    await input('[aria-label="验收数量"]', '2');
    await click('验收并入库');
    expect(repository.snapshot().inventoryEntries[0]).toMatchObject({
      requestId: 'PREQ-001',
      quantity: 2,
      totalCents: 1600
    });
    expect(container.textContent).toContain('INV-001');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
