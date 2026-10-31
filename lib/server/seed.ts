import { IRPCFile } from '@irpclib/irpc';
import { exists, write } from '@irpclib/r2-file';

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

/** The hidden file recording that a home was seeded, so it's never seeded again. */
export const SEED_MARKER = '~/.seeded';

/** Each session's seeding in this process: concurrent first calls share it, later ones skip it. */
const SEEDING = new Map<string, Promise<void>>();

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
    seeding = plant(seeds);
    SEEDING.set(session, seeding);
    // A failed seeding is tried again on the session's next call.
    seeding.catch(() => SEEDING.delete(session));
  }
  return seeding;
}

async function plant(seeds: Record<string, string>): Promise<void> {
  if (await exists(SEED_MARKER)) return;
  await Promise.all(
    Object.entries(seeds).map(([path, content]) => {
      const [, type] = INLINE.exec(content) ?? [];
      return type ? write(`~/${path}`, fileOf(path, type, content)) : write(`~/${path}`, content);
    }),
  );
  await write(SEED_MARKER, { seeded: new Date().toISOString() }, { hidden: true });
}

/**
 * A bundled picture or sound as the file it is, written as an upload is, at any size.
 *
 * @param path - Its path in the home.
 * @param type - Its media type.
 * @param content - Its data URL.
 * @returns The file.
 */
function fileOf(path: string, type: string, content: string): IRPCFile {
  const bytes = Uint8Array.from(atob(content.slice(content.indexOf(',') + 1)), (byte) => byte.charCodeAt(0));
  return new IRPCFile({ name: path.slice(path.lastIndexOf('/') + 1), size: bytes.byteLength, type }, new Blob([bytes], { type }));
}
