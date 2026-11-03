import { getContext, IRPCFile, setContext } from '@irpclib/irpc';
import type { ExecutionContext } from '@irpclib/irpc/wrangler';
import { exists, write } from '@irpclib/r2-file';
import type { HomeIndexing } from '@/lib/kernel/home.h.js';
import TITLES from '../../seeds/titles.json';

/** The context key a request's execution context is kept under, which indexing runs behind. */
const EXECUTION_KEY = 'ctx';

/** Where a new home's seed is bundled from, beside the app. */
const SOURCE = '../../seeds/home/';

/** The home seed's text as bundled, by its path from here. */
const BUNDLED_TEXT = import.meta.glob(['../../seeds/home/**/*', '!**/*.{png,jpg,jpeg,webp,gif,mp4,webm,mp3,wav}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The home seed's pictures and media, bundled inline as data URLs: raw, their bytes wouldn't survive. */
const BUNDLED_MEDIA = import.meta.glob('../../seeds/home/**/*.{png,jpg,jpeg,webp,gif,mp4,webm,mp3,wav}', {
  query: '?inline',
  import: 'default',
  eager: true,
});

/**
 * What every new home starts with, by its path in the home without `~/` (`Agents/Story.agent`):
 * `seeds/home/X` lands at `~/X`. Text as it is; pictures and media as data URLs.
 */
export const HOME_SEEDS: Record<string, string> = Object.fromEntries(
  Object.entries({ ...BUNDLED_TEXT, ...BUNDLED_MEDIA } as Record<string, string>).map(([file, content]) => [
    file.slice(SOURCE.length),
    content,
  ]),
);

/** A seed bundled inline, and the media type it carries, unlike any text seed. */
const INLINE = /^data:([^;,]+)/;

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
 * @param seeds - What to seed, by path in the home without `~/`.
 * @returns When the home is seeded.
 */
export function seedHome(session: string, seeds: Record<string, string> = HOME_SEEDS): Promise<void> {
  let seeding = SEEDING.get(session);
  if (!seeding) {
    seeding = plant(session, seeds);
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
async function plant(session: string, seeds: Record<string, string>): Promise<void> {
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
    await Promise.all(
      Object.entries(seeds).map(([path, content]) => {
        const [, inline] = INLINE.exec(content) ?? [];
        const type = inline ?? TEXT_MEDIA[path.slice(path.lastIndexOf('.') + 1)];
        // Files are named by id, so what a seed file is called comes with it, as an upload's does.
        const title = (TITLES as Record<string, string>)[path];
        const options = title ? { metadata: { title } } : undefined;
        if (!type) return write(`~/${path}`, content, options);
        const bytes = inline ? decoded(content) : new TextEncoder().encode(content);
        return write(`~/${path}`, fileOf(path, type, bytes), options);
      }),
    );
  } finally {
    setContext(EXECUTION_KEY, request);
    indexing.written = true;
    tell();
  }
  await write(SEED_MARKER, { seeded: new Date().toISOString() }, { hidden: true });
}

/**
 * A bundled picture or sound as the file it is, written as an upload is, at any size.
 *
 * @param path - Its path in the home.
 * @param type - Its media type.
 * @param bytes - Its content.
 * @returns The file.
 */
function fileOf(path: string, type: string, bytes: Uint8Array): IRPCFile {
  return new IRPCFile({ name: path.slice(path.lastIndexOf('/') + 1), size: bytes.byteLength, type }, new Blob([bytes], { type }));
}

/** The bytes a base64 data URL holds. */
function decoded(content: string): Uint8Array {
  return Uint8Array.from(atob(content.slice(content.indexOf(',') + 1)), (byte) => byte.charCodeAt(0));
}
