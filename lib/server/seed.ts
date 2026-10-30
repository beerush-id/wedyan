import { exists, write } from '@irpclib/r2-file';

/** Where a new home's seed is bundled from, beside the app. */
const SOURCE = '../../seeds/home/';

/** The home seed as bundled, by its path from here. */
const BUNDLED = import.meta.glob('../../seeds/home/**/*', { query: '?raw', import: 'default', eager: true });

/**
 * What every new home starts with, by its path in the home without `~/` (`Agents/Story.agent`):
 * `seeds/home/X` lands at `~/X`.
 */
export const HOME_SEEDS: Record<string, string> = Object.fromEntries(
  Object.entries(BUNDLED as Record<string, string>).map(([file, text]) => [file.slice(SOURCE.length), text]),
);

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
  await Promise.all(Object.entries(seeds).map(([path, text]) => write(`~/${path}`, text)));
  await write(SEED_MARKER, { seeded: new Date().toISOString() }, { hidden: true });
}
