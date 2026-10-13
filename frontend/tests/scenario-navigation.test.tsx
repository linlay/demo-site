import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import ScenarioCatalogPage from '../src/pc/pages/ScenarioCatalogPage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

it('opens the workbench at home and keeps the complete searchable directory at /navigation', async () => {
  expect(scopeKeyForRoute(resolveRoute('/'))).toBe('demo-site.scene.O01');
  expect(resolveRoute('/navigation').kind).toBe('catalog');
  const container = document.createElement('div');
  const root = createRoot(container);
  const navigate = vi.fn();
  try {
    await act(async () => root.render(<ScenarioCatalogPage navigate={navigate} />));
    expect(container.querySelectorAll('a')).toHaveLength(31);
    const input = container.querySelector('input');
    if (!input) throw new Error('Missing search');
    await act(async () =>
      Simulate.change(input, { target: { value: '条件字段' } } as unknown as Parameters<typeof Simulate.change>[1])
    );
    expect(container.querySelectorAll('a')).toHaveLength(1);
    await act(async () => container.querySelector('a')?.click());
    expect(navigate).toHaveBeenCalledWith('/scenes/S04');
    await act(async () =>
      Simulate.change(input, { target: { value: 'P06' } } as unknown as Parameters<typeof Simulate.change>[1])
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/scenes/P06');
    await act(async () =>
      Simulate.change(input, { target: { value: 'no-such-scene' } } as unknown as Parameters<typeof Simulate.change>[1])
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe('没有匹配的场景');
  } finally {
    await act(async () => root.unmount());
  }
});
