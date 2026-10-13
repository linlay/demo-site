import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AwcpSettingsService, AwcpSettingsState } from '../pc/service/awcpSettingsService';

export const AwcpSettingsContext = createContext<AwcpSettingsService | null>(null);
const unavailable: AwcpSettingsState = { loading: true, saving: false, error: '' };
const emptySubscription = () => () => undefined;
const unavailableSnapshot = () => unavailable;

export function useAwcpSettings(): AwcpSettingsState {
  const service = useContext(AwcpSettingsContext);
  return useSyncExternalStore(service?.subscribe ?? emptySubscription, service?.snapshot ?? unavailableSnapshot);
}
