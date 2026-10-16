import type { DemoSession } from '@app/api';
import { DemoClock } from '../../common/fixtures/clock';
import { DemoRepository, type DemoStorage } from '../../common/store/repository';

/** Transitional adapter for NOT YET migrated O/S services. Removed domain by domain.
 * It isolates the existing browser repository by server session/generation, without
 * importing, overwriting, or deleting the pre-migration localStorage key.
 * It does NOT claim that these business writes are persisted in SQLite.
 */
export function createSessionRepository(session: DemoSession, assertWritable?: () => void): DemoRepository {
  let storage: DemoStorage | undefined;
  try {
    const prefix = `awcp-session:${session.id}:${session.generation}:`;
    const local = window.localStorage;
    storage = {
      getItem: (key) => local.getItem(prefix + key),
      setItem: (key, value) => local.setItem(prefix + key, value),
      removeItem: (key) => local.removeItem(prefix + key)
    };
  } catch { storage = undefined; }
  return new DemoRepository({ seed: session.seed, clock: new DemoClock(session.simulatedAt), storage, workbenchSamples: true, workflowProfile: 'coarse-roles', assertWritable });
}
