import type { RemoteState } from '@irpclib/irpc';
import { kernel } from './package.js';

/** How long seeding a new home may take, in ms: its files are written before anything opens. */
const SEEDING_TIMEOUT = 120_000;

/** How far memory has read a new home's files: how many are indexed, of how many. */
export type HomeIndexing = { total: number; done: number };

/**
 * Waits for the session's home to be ready: on its first visit, seeded with every file a new home
 * starts with, so nothing opens onto a half-written home.
 */
export const homeReady = kernel.declare<() => Promise<void>>({
  name: 'home.ready',
  timeout: SEEDING_TIMEOUT,
});

/**
 * Follows memory reading a new home's files, until it has read them all. A home seeded before is
 * read already, so its stream ends at once.
 */
export const homeIndexing = kernel.declare<() => RemoteState<HomeIndexing>>({
  name: 'home.indexing',
  stream: true,
  keepAlive: true,
  coalesce: false,
  seed: () => ({ total: 0, done: 0 }),
});
