import { PreferencesProvider } from './common/preferences/Preferences';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DemoSessionBoundary } from './app/DemoSessionBoundary';
import { App } from './app/App';
import { AwcpSettingsProvider } from './app/AwcpSettingsProvider';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing application root element.');
}

createRoot(container).render(
  <StrictMode>
    <PreferencesProvider><DemoSessionBoundary><AwcpSettingsProvider><App /></AwcpSettingsProvider></DemoSessionBoundary></PreferencesProvider>
  </StrictMode>
);
