import { useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AwcpSettingsService } from '../pc/service/awcpSettingsService';
import { DemoSessionContext } from './demoSessionContext';
import { AwcpSettingsContext } from './awcpSettingsContext';

export function AwcpSettingsProvider({ children }: PropsWithChildren) {
  const demo = useContext(DemoSessionContext);
  const [service] = useState(() => {
    if (!demo) throw new Error('AWCP settings require a demo session.');
    return new AwcpSettingsService(demo.api);
  });
  useEffect(() => {
    void service.refresh();
    const refresh = () => { if (document.visibilityState === 'visible') void service.refresh(); };
    const timer = setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [service]);
  return <AwcpSettingsContext.Provider value={service}>{children}</AwcpSettingsContext.Provider>;
}
