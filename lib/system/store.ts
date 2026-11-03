import { getContext } from '@irpclib/irpc';
import { read, remove, write } from '@irpclib/r2-file';
import type { DocumentOf, DocumentType } from '@/lib/documents/types.js';
import { ACTOR_KEY, AGENT_ACTOR, ASK_KEY, type SysAsk } from '@/lib/kernel/agent.js';
import { DOC_CONFIRM } from '@/lib/kernel/document.h.js';

/** How many slow things one call makes at once: a whole episode at once would queue at the model anyway. */
const MAKING_AT_ONCE = 4;

/**
 * The ask a call is made in, when an agent made it: the desktop calling a function has none.
 *
 * @returns The ask, if there is one.
 */
export const askOf = (): SysAsk | undefined => getContext<SysAsk>(ASK_KEY);

/**
 * Runs a piece of slow work: as a row of the answer when an agent asked for it.
 *
 * @param name - What it is.
 * @param detail - What it's working on.
 * @param work - The work.
 * @returns What it gave.
 */
export function activity<T>(name: string, detail: string, work: () => Promise<T>): Promise<T> {
  return askOf()?.activity(name, detail, work) ?? work();
}

/**
 * The folder a new file goes in. A model can write "no folder" as the word `null`, which would
 * otherwise become a folder of that name.
 *
 * @param cwd - The folder asked for, if any.
 * @param home - Where this kind of file lives.
 * @returns The folder; throws when it isn't in the home.
 */
export function folderOf(cwd: string | null | undefined, home: string): string {
  const folder = cwd?.trim().replace(/\/+$/, '');
  if (!folder || folder === 'null' || folder === 'undefined') return home;
  if (!folder.startsWith('~/')) throw new Error(`${cwd} isn't a folder in the home (~/…): pass null for ${home}`);
  return folder;
}

/**
 * Makes each of a list, a few at a time, in its order.
 *
 * @param items - What's asked for.
 * @param make - What makes one.
 * @returns What each made.
 */
export async function eachOf<T, R>(items: T[], make: (item: T) => Promise<R>): Promise<R[]> {
  const made: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      made[at] = await make(items[at]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAKING_AT_ONCE, items.length) }, worker));
  return made;
}

/**
 * A document in the home, of the type its path says. Only a tool's own kind of file reaches it, so
 * no call can read or change anything else through it.
 *
 * @param path - Its home path (`~/…`).
 * @param type - What it must be.
 * @returns The document; throws when it isn't there.
 */
export async function documentOf<T extends DocumentType>(path: string, type: T): Promise<DocumentOf<T>> {
  if (!path.startsWith('~/') || !path.endsWith(`.${type}`)) throw new Error(`${path} isn't a .${type} in the home (~/…)`);
  const document = await read<DocumentOf<T>>(path, { encoding: 'json' }).catch(() => undefined);
  if (!document) throw new Error(`There's no ${type} at ${path}`);
  return document;
}

/** The change to each file last in line. */
const changes = new Map<string, Promise<unknown>>();

/**
 * Changes a document after any change already going on it, so what's changed side by side isn't
 * lost. Nothing is written if the change throws, so a refused change leaves it as it was.
 *
 * @param path - Its home path (`~/…`).
 * @param type - What it must be.
 * @param change - What changes, in place.
 * @returns The document, as written.
 */
export function changeDocument<T extends DocumentType>(
  path: string,
  type: T,
  change: (document: DocumentOf<T>) => void | Promise<void>,
): Promise<DocumentOf<T>> {
  const turn = (changes.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const document = await documentOf(path, type);
      await change(document);
      document.updated = new Date().toISOString();
      await write(path, document as never);
      return document;
    })
    .finally(() => {
      if (changes.get(path) === turn) changes.delete(path);
    });
  changes.set(path, turn);
  return turn;
}

/**
 * Whether what would trash something may go ahead. The desktop's own call has already asked; an
 * agent's asks the user here, so no prompt or plan can skip it, and a desktop that isn't there is a no.
 *
 * @param message - What saying yes means, in a line.
 * @returns Whether it may.
 */
export async function userAgrees(message: string): Promise<boolean> {
  if (getContext<string>(ACTOR_KEY) !== AGENT_ACTOR) return true;
  const ask = askOf();
  const answer = await ask?.desktop({ name: DOC_CONFIRM, args: { message }, after: -1, ask: true, agent: ask.agent });
  return (answer as { confirmed?: boolean } | undefined)?.confirmed === true;
}

/**
 * Moves files to the trash, with the folder each keeps what it made in (`Hero.still` keeps `Hero/`).
 *
 * @param paths - The files.
 * @returns When they're gone.
 */
export async function trash(paths: string[]): Promise<void> {
  await Promise.all(
    paths.flatMap((path) => [
      remove(path, { soft: true }),
      remove(path.slice(0, path.lastIndexOf('.')), { soft: true, recursive: true }).catch(() => undefined),
    ]),
  );
}
