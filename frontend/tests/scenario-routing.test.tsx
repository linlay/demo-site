import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { App } from '../src/app/App';
import { AwcpSettingsContext } from '../src/app/awcpSettingsContext';
import { AwcpSettingsService } from '../src/pc/service/awcpSettingsService';
import { SCENARIOS } from '../src/common/scenarios/catalog';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

it('resolves list, typed creation and independent object routes', () => {
  expect(SCENARIOS).toHaveLength(31);
  const list = resolveRoute('/scenes/O03');
  const form = resolveRoute('/scenes/O03/new/notice');
  const detail = resolveRoute('/scenes/O03/objects/NTC-001');
  expect(list).toMatchObject({ kind: 'scene' });
  expect(form).toMatchObject({ kind: 'scene', formType: 'notice' });
  expect(detail).toMatchObject({ kind: 'scene', objectId: 'NTC-001' });
  expect(new Set([scopeKeyForRoute(list), scopeKeyForRoute(form), scopeKeyForRoute(detail)]).size).toBe(3);
  expect(resolveRoute('/scenes/O03/objects/%ZZ').kind).toBe('not-found');
});

it('only exposes the current page actions after navigation', async () => {
  const priorUrl = window.location.href;
  const priorApi = window.awcp;
  const settings = { activeEnabled: true, version: 1 };
  const exposure = new AwcpSettingsService({ awcpSettings: async () => settings, updateAwcpSettings: async () => settings });
  await exposure.refresh();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const open = async (path: string) => {
    await act(async () => {
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => { await import('../src/pc/pages/BusinessScenePage'); await import('../src/pc/pages/O03NoticePage'); await import('../src/pc/pages/O03NoticeNewPage'); });
    const manual = window.awcp?.manual();
    if (!manual || !('sections' in manual)) throw new Error('AWCP manual missing.');
    return manual;
  };
  try {
    window.history.replaceState(null, '', '/');
    await act(async () => root.render(<StrictMode><AwcpSettingsContext.Provider value={exposure}><App /></AwcpSettingsContext.Provider></StrictMode>));
    const list = await open('/scenes/O03');
    expect(container.textContent).toContain('已有事项');
    expect(list.sections).toHaveLength(0);
    const form = await open('/scenes/O03/new/notice');
    expect(form.sections.map((item) => item.section)).toContain('office.notice.draft');
    expect(form.sections.map((item) => item.section)).not.toContain('office.notice.read');
    const detail = await open('/scenes/O03/objects/NTC-001');
    expect(detail.sections.map((item) => item.section)).toContain('office.notice.read');
    expect(detail.sections.map((item) => item.section)).not.toContain('office.notice.draft');
    expect(detail.revision).not.toBe(form.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, '', priorUrl);
    expect(window.awcp).toBe(priorApi);
  }
});

it('opens a listed S01 object through its visible link', async () => {
  const priorUrl = window.location.href;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    window.history.replaceState(null, '', '/scenes/S01');
    await act(async () => root.render(<App />));
    await act(async () => { await import('../src/pc/pages/BusinessScenePage'); await import('../src/pc/pages/S01ClientPage'); });
    const link = container.querySelector<HTMLAnchorElement>('a[href="/scenes/S01/objects/CLI-001"]');
    expect(link).not.toBeNull();
    await act(async () => link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    expect(window.location.pathname).toBe('/scenes/S01/objects/CLI-001');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, '', priorUrl);
  }
});
