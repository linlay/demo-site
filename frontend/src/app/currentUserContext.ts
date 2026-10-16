import { createContext, useContext } from 'react';
import type { SessionEmployee } from '@app/api';

export interface CurrentUserValue {
  actorId: string;
  user?: SessionEmployee;
  employees: SessionEmployee[];
  departments: ReadonlyArray<{ id: string; name: string }>;
  changeUser(id: string): void;
}
export const CurrentUserContext = createContext<CurrentUserValue | null>(null);
export function useCurrentUser() {
  return useContext(CurrentUserContext);
}

/** Isolated protocol fixtures can provide a fixed actor; the application always uses the account provider. */
export function useCurrentActor(fixtureActor: string | (() => string) = 'EMP-002'): string {
  const identity = useCurrentUser();
  return identity ? identity.actorId : typeof fixtureActor === 'function' ? fixtureActor() : fixtureActor;
}
