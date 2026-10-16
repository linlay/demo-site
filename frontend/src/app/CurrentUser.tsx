import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { SessionEmployee } from '@app/api';
import { CurrentUserContext } from './currentUserContext';

export function CurrentUserProvider({
  employees,
  departments = [],
  storageKey,
  initialActorId = 'EMP-002',
  children
}: PropsWithChildren<{
  employees: ReadonlyArray<SessionEmployee>;
  departments?: ReadonlyArray<{ id: string; name: string }>;
  storageKey?: string;
  initialActorId?: string;
}>) {
  const active = useMemo(() => employees.filter((employee) => employee.active), [employees]);
  const [selected, setSelected] = useState(() => {
    try {
      return (storageKey && localStorage.getItem(storageKey)) || initialActorId;
    } catch {
      return initialActorId;
    }
  });
  const user =
    active.find((employee) => employee.id === selected) ??
    active.find((employee) => employee.id === initialActorId) ??
    active[0];
  const actorId = user?.id ?? '';
  const changeUser = useCallback(
    (id: string) => {
      if (active.some((employee) => employee.id === id)) setSelected(id);
    },
    [active]
  );
  useEffect(() => {
    if (!storageKey || !actorId) return;
    try {
      localStorage.setItem(storageKey, actorId);
    } catch {
      /* Identity still works without persistence. */
    }
  }, [actorId, storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue) changeUser(event.newValue);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [changeUser, storageKey]);
  useEffect(() => {
    // Old source links may contain actor hints. Account identity is authoritative.
    const clean = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.has('actor')) {
        url.searchParams.delete('actor');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    };
    clean();
    window.addEventListener('popstate', clean);
    return () => window.removeEventListener('popstate', clean);
  }, []);
  const value = useMemo(
    () => ({ actorId, user, employees: active, departments, changeUser }),
    [actorId, user, active, departments, changeUser]
  );
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}
