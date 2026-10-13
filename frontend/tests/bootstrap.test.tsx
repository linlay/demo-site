import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { App } from '../src/app/App';

it('opens the scene catalog as a normal page while AWCP settings are unavailable', async () => {
  const previous = window.awcp;
  const previousUrl = window.location.href;
  const container = document.createElement('div');
  const root = createRoot(container);

  try {
    window.history.replaceState(null, '', '/navigation');
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>
      );
    });
    await act(async () => {
      await import('../src/pc/pages/ScenarioCatalogPage');
    });

    expect(window.awcp).toBe(previous);
    expect(container.textContent).toContain('站内导航');
    expect(container.querySelectorAll('section[aria-label="站内导航"] a[href^="/scenes/"]').length).toBe(31);
  } finally {
    await act(async () => root.unmount());
    window.history.replaceState(null, '', previousUrl);
  }

  expect(window.awcp).toBe(previous);
});
