import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';
import { useAwcpAction, type JsonValue, type AwcpBrowserApi } from '@app/awcp';
import { AppProviders } from '../src/app/AppProviders';

function browserApi(): AwcpBrowserApi | undefined { return window.awcp; }

function OrdinaryPage() {
  const [count, setCount] = useState(0);
  useAwcpAction({
    action: 'test.exposure.wait',
    title: 'Wait for cancellation',
    description: 'A read-only action that waits for cancellation.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    invoke: (_args, context) => new Promise<JsonValue>((resolve) => {
      context.signal.addEventListener('abort', () => resolve({ status: 'completed', data: {} }), { once: true });
    })
  });
  return <button onClick={() => setCount((value) => value + 1)}>Ordinary page {count}</button>;
}

it('exposes AWCP only while enabled, revokes cached interfaces and keeps ordinary page state', async () => {
  const previous = window.awcp;
  delete window.awcp;
  const container = document.createElement('div');
  const pageRoot = createRoot(container);
  const render = (enabled: boolean) => act(async () => pageRoot.render(
    <StrictMode><AppProviders site={{ name: 'Test', description: 'Exposure test' }} scopeKey="test" exposeAwcp={enabled}>
      <OrdinaryPage />
    </AppProviders></StrictMode>
  ));
  try {
    await render(false);
    expect(window.awcp).toBeUndefined();
    await act(async () => container.querySelector('button')?.click());
    expect(container.textContent).toContain('Ordinary page 1');
    await render(true);
    const api = browserApi();
    if (!api) throw new Error('AWCP was not enabled.');
    const manual = api.manual();
    if (!('sections' in manual)) throw new Error('Expected a manual index.');
    expect(manual.sections.map((section) => section.section)).toContain('test.exposure.wait');
    const request = { requestId: 'waiting', revision: manual.revision, action: 'test.exposure.wait', args: {} };
    const pending = api.invoke(request);
    await act(async () => { await Promise.resolve(); });
    await render(false);
    expect(window.awcp).toBeUndefined();
    expect(container.textContent).toContain('Ordinary page 1');
    expect(() => api.manual()).toThrow('disabled');
    await expect(api.invoke({ ...request, requestId: 'cached' })).rejects.toThrow('disabled');
    expect(api.cancel('waiting')).toBe(false);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    await render(true);
    expect(window.awcp).not.toBe(api);
  } finally {
    await act(async () => { pageRoot.unmount(); });
    if (previous) window.awcp = previous;
    else delete window.awcp;
  }
});

function desktopApi(): AwcpBrowserApi {
  return {
    protocolVersion: 1,
    manual: () => ({ revision: 'desktop', site: { name: 'Desktop injection', description: 'Host-owned interface' }, sections: [] }),
    invoke: async (request) => ({ ok: true, requestId: request.requestId, action: request.action, result: { source: 'desktop' } }),
    cancel: () => false
  };
}

it('keeps Desktop WebView injection independent from website active exposure', async () => {
  const previous = window.awcp;
  const desktop = desktopApi();
  window.awcp = desktop;
  const root = createRoot(document.createElement('div'));
  const render = (enabled: boolean) => act(async () => root.render(
    <StrictMode><AppProviders site={{ name: 'Test', description: 'Exposure test' }} scopeKey="test" exposeAwcp={enabled}>
      <OrdinaryPage />
    </AppProviders></StrictMode>
  ));
  try {
    await render(false);
    expect(browserApi()).toBe(desktop);
    await render(true);
    const native = browserApi();
    if (!native) throw new Error('Website interface was not exposed.');
    expect(native).not.toBe(desktop);
    await render(false);
    expect(browserApi()).toBe(desktop);
    expect(() => native.manual()).toThrow('disabled');
    await expect(desktop.invoke({ requestId: 'host', revision: 'desktop', action: 'host.read', args: {} }))
      .resolves.toMatchObject({ ok: true, result: { source: 'desktop' } });

    await render(true);
    const latestNative = browserApi();
    if (!latestNative) throw new Error('Website interface was not exposed again.');
    const laterInjection = desktopApi();
    window.awcp = laterInjection;
    await render(false);
    expect(browserApi()).toBe(laterInjection);
    expect(() => latestNative.manual()).toThrow('disabled');
  } finally {
    await act(async () => root.unmount());
    if (previous) window.awcp = previous;
    else delete window.awcp;
  }
});
