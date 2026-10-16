import { Fragment, type PropsWithChildren } from 'react';
import { act } from 'react-dom/test-utils';
import { CurrentUserProvider } from '../src/app/CurrentUser';
import { useCurrentUser } from '../src/app/currentUserContext';
import { createSeedState } from '../src/common/fixtures/seed';

export function createIdentityHarness(initialActorId: string) {
  const seed = createSeedState();
  let change: ((id: string) => void) | undefined;
  function Scope({ children }: PropsWithChildren) {
    const identity = useCurrentUser();
    change = identity?.changeUser;
    return <Fragment key={identity?.actorId}>{children}</Fragment>;
  }
  function Provider({ children }: PropsWithChildren) {
    return (
      <CurrentUserProvider initialActorId={initialActorId} employees={seed.employees} departments={seed.departments}>
        <Scope>{children}</Scope>
      </CurrentUserProvider>
    );
  }
  return {
    Provider,
    switchUser: async (id: string) => {
      if (!change) throw new Error('Identity provider not mounted');
      await act(async () => change?.(id));
    }
  };
}
