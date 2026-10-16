import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import B06WorkspacePage from '../src/pc/pages/B06WorkspacePage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

it('discovers and invokes travel.submit through the real two-level manual and shares UI state', async () => {
  const repository = new DemoRepository();
  const route = resolveRoute('/scenes/O09/new/travel');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
          <B06WorkspacePage repository={repository} formType="travel" />
        </AppProviders>
      )
    );
    const api = window.awcp;
    if (!api) throw new Error('AWCP browser bridge is missing.');
    const index = api.manual();
    if (!('sections' in index)) throw new Error('Expected AWCP manual index.');
    expect(index.sections.some((item) => item.section === 'office.travel.submit')).toBe(true);
    const section = api.manual({ section: 'office.travel.submit', revision: index.revision }) as AwcpManualSection;
    expect(section.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    const example = section.examples?.[0] as JsonObject | undefined;
    if (!example) throw new Error('Expected a valid travel example.');
    const invoke = (args: JsonObject, requestId: string) =>
      api.invoke({
        action: 'office.travel.submit',
        args,
        revision: index.revision,
        requestId
      });

    const before = repository.snapshot();
    const reversed = await invoke({ ...example, endAt: '2026-09-23T18:00:00+08:00' }, 'travel-invalid-dates');
    expect(reversed).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_arguments',
        details: { executionStarted: false, fieldErrors: [expect.objectContaining({ path: ['endAt'] })] }
      }
    });
    expect(repository.snapshot()).toEqual(before);

    let response: AwcpActionResponse | undefined;
    await act(async () => {
      response = await invoke(example, 'travel-example-first');
    });
    expect(response).toMatchObject({
      ok: true,
      result: { status: 'completed', data: { formId: 'FORM-003', status: 'submitted', businessVersion: 1 } }
    });
    expect(repository.snapshot().travelRequests.find((item) => item.formId === 'FORM-003')?.destination).toBe('北京');
    expect(container.querySelector<HTMLInputElement>('#travel-origin')?.value).toBe('');

    await act(async () => {
      response = await invoke(example, 'travel-example-replay');
    });
    expect(response).toMatchObject({ ok: true, result: { data: { formId: 'FORM-003' } } });
    expect(repository.snapshot().travelRequests.filter((item) => item.formId === 'FORM-003')).toHaveLength(1);

    const fill = async (selector: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || !setter) throw new Error(`Missing field ${selector}`);
      await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    };
    expect(container.querySelector('#travel-actor')).toBeNull();
    await fill('#travel-origin', '上海');
    await fill('#travel-destination', '北京');
    await fill('#travel-start', '2026-09-24T09:00');
    await fill('#travel-end', '2026-09-25T18:00');
    await fill('#travel-amount', '180000');
    expect(container.querySelector<HTMLInputElement>('#travel-origin')?.value).toBe('上海');
    await act(async () => {
      container
        .querySelector<HTMLFormElement>('form[aria-label="提交出差申请"]')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const state = repository.snapshot();
    expect(state.travelRequests.map((item) => item.formId)).toEqual(['FORM-001', 'FORM-003', 'FORM-004']);
    expect(state.todos.find((item) => item.sourceId === 'FORM-004')?.assigneeId).toBe('EMP-002');
    expect(state.travelRequests.find((item) => item.formId === 'FORM-004')?.origin).toBe('上海');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
