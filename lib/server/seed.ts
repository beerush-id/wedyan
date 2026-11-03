import { getContext, getEnv, IRPCFile, setContext } from '@irpclib/irpc';
import type { ExecutionContext } from '@irpclib/irpc/wrangler';
import { exists, write } from '@irpclib/r2-file';
import { MEDIA, MEDIA_URL, readMedia, TEXT } from 'virtual:home-seed';
import type { HomeIndexing } from '@/lib/kernel/home.h.js';
import type { ServerEnv } from '@/lib/server/setup.js';
import TITLES from '../../seeds/titles.json';

/** The context key a request's execution context is kept under, which indexing runs behind. */
const EXECUTION_KEY = 'ctx';

/** Any origin: the platform's assets answer by path alone. */
const ASSETS_ORIGIN = 'https://assets.local';

/**
 * What a home is seeded with, by path in the home without `~/` (`Agents/Story.agent`): text as it
 * is, and each picture or media by what reads it, as a file of its type.
 */
export type HomeSeed = { text: Record<string, string>; media: Record<string, () => Promise<Blob>> };

/**
 * What every new home starts with: `seeds/home/X` lands at `~/X`. Its text is bundled; its pictures
 * and media are among the client build's files, read as a home is seeded, so they never weigh on
 * the worker.
 */
export const HOME_SEED: HomeSeed = {
  text: TEXT,
  media: Object.fromEntries(Object.entries(MEDIA).map(([path, type]) => [path, () => mediaOf(path, type)])),
};

/** Text seeds that are pictures, not documents, by extension: written as files of their type. */
const TEXT_MEDIA: Record<string, string> = { svg: 'image/svg+xml' };

/** The hidden file recording that a home was seeded, so it's never seeded again. */
export const SEED_MARKER = '~/.seeded';

/** Each session's seeding in this process: concurrent first calls share it, later ones skip it. */
const SEEDING = new Map<string, Promise<void>>();

/** A home's indexing since it was seeded, whether every file is written yet, and who is told each time it moves. */
type Indexing = HomeIndexing & { written: boolean; listeners: Set<() => void> };

/** Each seeded home's indexing in this process, by session. */
const INDEXING = new Map<string, Indexing>();

/**
 * Seeds a session's home once: every seed file is written into it, and indexed like any file, then
 * a marker records it, so the seed never comes back over what the user changed or removed. Runs in
 * the session's file scope.
 *
 * @param session - The session whose home it is.
 * @param seed - What to seed.
 * @returns When the home is seeded.
 */
export function seedHome(session: string, seed: HomeSeed = HOME_SEED): Promise<void> {
  let seeding = SEEDING.get(session);
  if (!seeding) {
    seeding = plant(session, seed);
    SEEDING.set(session, seeding);
    // A failed seeding is tried again on the session's next call.
    seeding.catch(() => SEEDING.delete(session));
  }
  return seeding;
}

/**
 * How far memory has read a home seeded in this process, told each time it moves.
 *
 * @param session - The session whose home it is.
 * @param listener - Told the indexing each time it moves, and whether it has finished.
 * @returns How to stop being told; nothing when there's nothing to follow, as its files were read
 *   already or this process didn't seed them.
 */
export function followIndexing(session: string, listener: (indexing: HomeIndexing, finished: boolean) => void): (() => void) | undefined {
  const indexing = INDEXING.get(session);
  if (!indexing) return;
  const told = () => listener({ total: indexing.total, done: indexing.done }, indexing.written && indexing.done === indexing.total);
  indexing.listeners.add(told);
  told();
  return () => indexing.listeners.delete(told);
}

/**
 * Writes the seed into the home. A file is there once written: memory reads it behind the seeding,
 * so the home is ready before every file is indexed, and how far that has got is kept for the session.
 */
async function plant(session: string, seed: HomeSeed): Promise<void> {
  if (await exists(SEED_MARKER)) return;

  const indexing: Indexing = { total: 0, done: 0, written: false, listeners: new Set() };
  INDEXING.set(session, indexing);
  // Once every file is written and read, there's nothing left to follow.
  const tell = () => {
    for (const listener of indexing.listeners) listener();
    if (indexing.written && indexing.done === indexing.total) INDEXING.delete(session);
  };
  // Each write hands its indexing over instead of waiting for it; the platform still keeps it alive.
  const request = getContext<ExecutionContext>(EXECUTION_KEY);
  setContext(EXECUTION_KEY, {
    waitUntil(work: Promise<unknown>) {
      indexing.total++;
      tell();
      void work.finally(() => {
        indexing.done++;
        tell();
      });
      request?.waitUntil(work);
    },
    passThroughOnException() {},
  } satisfies ExecutionContext);

  try {
    await Promise.all([
      ...Object.entries(seed.text).map(([path, content]) => {
        const type = TEXT_MEDIA[path.slice(path.lastIndexOf('.') + 1)];
        if (!type) return write(`~/${path}`, content, optionsOf(path));
        return write(`~/${path}`, fileOf(path, new Blob([content], { type })), optionsOf(path));
      }),
      ...Object.entries(seed.media).map(async ([path, read]) => write(`~/${path}`, fileOf(path, await read()), optionsOf(path))),
    ]);
  } finally {
    setContext(EXECUTION_KEY, request);
    indexing.written = true;
    tell();
  }
  await write(SEED_MARKER, { seeded: new Date().toISOString() }, { hidden: true });
}

/** Files are named by id, so what a seed file is called comes with it, as an upload's does. */
function optionsOf(path: string) {
  const title = (TITLES as Record<string, string>)[path];
  return title ? { metadata: { title } } : undefined;
}

/**
 * A seed picture or sound as the file it is, written as an upload is, at any size.
 *
 * @param path - Its path in the home.
 * @param content - Its content, of its type.
 * @returns The file.
 */
function fileOf(path: string, content: Blob): IRPCFile {
  return new IRPCFile({ name: path.slice(path.lastIndexOf('/') + 1), size: content.size, type: content.type }, content);
}

/**
 * Reads a seed picture or media: beside the server in development, among the client build's files
 * once deployed.
 *
 * @param path - Its path in the home.
 * @param type - Its media type.
 * @returns Its content, of its type.
 */
async function mediaOf(path: string, type: string): Promise<Blob> {
  if (readMedia) return new Blob([await readMedia(path)], { type });
  const assets = getEnv<ServerEnv>().ASSETS;
  if (!assets) throw new Error(`No ASSETS binding to read the seed's ${path} from`);
  const response = await assets.fetch(new Request(new URL(`${MEDIA_URL}/${path}`, ASSETS_ORIGIN)));
  if (!response.ok) throw new Error(`The seed's ${path} couldn't be read: ${response.status}`);
  return new Blob([await response.arrayBuffer()], { type });
}
