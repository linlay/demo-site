import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { useAwcpAction, type AwcpBrowserApi } from '@app/awcp';
import { AppProviders } from '../src/app/AppProviders';
import { AwcpSettingsContext, useAwcpSettings } from '../src/app/awcpSettingsContext';
import { AwcpSettingsService } from '../src/pc/service/awcpSettingsService';
import { AwcpControls } from '../src/pc/components/AwcpControls';

function browserApi(): AwcpBrowserApi | undefined { return window.awcp; }
function OrdinaryForm() {
  const [draft, setDraft] = useState('');
  useAwcpAction({ action: 'test.settings.read', title: 'Read', description: 'Read a synthetic value.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, invoke: () => ({ value: 1 }) });
  return <input aria-label="Ordinary draft" value={draft} onChange={(event) => setDraft(event.target.value)} />;
}
function Page() {
  const state = useAwcpSettings();
  return <AppProviders site={{ name: 'Normal page', description: 'Normal form' }} scopeKey="normal" exposeAwcp={state.settings?.activeEnabled === true}>
    <AwcpControls /><OrdinaryForm />
  </AppProviders>;
}

it('saves the switch, retains ordinary drafts and restores the server setting on a fresh page', async () => {
  const previous = window.awcp;
  delete window.awcp;
  let saved = { activeEnabled: false, version: 1 };
  const update = vi.fn(async (activeEnabled: boolean, expectedVersion: number) => {
    expect(expectedVersion).toBe(saved.version);
    saved = { activeEnabled, version: saved.version + 1 };
    return saved;
  });
  const api = { awcpSettings: async () => saved, updateAwcpSettings: update };
  const service = new AwcpSettingsService(api);
  const container = document.createElement('div');
  let root = createRoot(container);
  const render = (value: AwcpSettingsService) => act(async () => root.render(
    <StrictMode><AwcpSettingsContext.Provider value={value}><Page /></AwcpSettingsContext.Provider></StrictMode>
  ));
  try {
    await render(service);
    expect(browserApi()).toBeUndefined();
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
    await act(async () => service.refresh());
    const input = container.querySelector('input');
    if (!input) throw new Error('Missing ordinary form.');
    await act(async () => Simulate.change(input, { target: { value: 'unsaved draft' } } as unknown as Parameters<typeof Simulate.change>[1]));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    expect(update).toHaveBeenCalledWith(true, 1);
    expect(browserApi()?.manual()).toMatchObject({ sections: [{ section: 'test.settings.read' }] });
    expect(input.value).toBe('unsaved draft');
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    expect(update).toHaveBeenCalledWith(false, 2);
    expect(browserApi()).toBeUndefined();
    expect(input.value).toBe('unsaved draft');
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await act(async () => root.unmount());
    root = createRoot(container);
    const next = new AwcpSettingsService(api);
    await render(next);
    expect(browserApi()).toBeUndefined();
    await act(async () => next.refresh());
    expect(browserApi()?.protocolVersion).toBe(1);
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    if (previous) window.awcp = previous;
    else delete window.awcp;
  }
});
