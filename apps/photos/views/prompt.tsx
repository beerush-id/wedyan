import { mutable } from '@airlib/react';
import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { rowsOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { linkTo } from '@/lib/systems/links.js';
import type { Commands } from '@/lib/systems/public.js';
import type { PromptEvent } from '@/lib/systems/registry.js';
import { GenerativeIcon } from './icons.js';
import { type FolderView, modifiedOf, pictureOf, ROOTS, shownRows } from './listing.js';
import { destination, dockRequest, generation, makeAttempts, makeStill, making } from './making.js';
import type { StillData } from './Still.js';

/** What a suggestion is when it's a picture. */
const PICTURE = 'picture';

/** The longest a still is called, cut from the prompt it's made from. */
const NAME_LENGTH = 60;

/** The listings `@` reads, one for each folder, replaced whole as they're asked for again. */
const listed = mutable({} as Partial<Record<FolderView, ReturnType<typeof dfs.list>>>, { recursive: false });

let listening = false;

/** What Photos can do, at `system.photos.name`. */
export const COMMANDS: Commands = {
  generate: {
    hint: 'Make an image',
    icon: <GenerativeIcon />,
    contexts: pictures,
    handle: ({ event }) => {
      const prompt = event as PromptEvent;
      const ask = askIn(prompt);
      if (!ask) return 'Say what to make after /generate.';
      const still = (prompt.context.activeWindow?.data as StillData | undefined)?.still;
      return still ? makeAgain(still, ask, prompt) : makeNew(ask, prompt);
    },
  },
};

/**
 * Every picture on the drive, as `@` offers them: while Photos is in front, and after `/generate` to
 * make from. The listings are asked for the first time they're wanted, and again as a file changes;
 * what reads this only follows them.
 *
 * @returns The pictures, each with its path as its value, shown by its own picture.
 */
export function pictures(): DockSuggestion[] {
  if (!listening) {
    listening = true;
    // Outside whoever's reading: a listing outlives what's drawn, and asking isn't a read.
    queueMicrotask(() => {
      for (const view of Object.keys(ROOTS) as FolderView[]) {
        const list = () => {
          listed[view] = dfs.list(ROOTS[view], { recursive: true });
        };
        list();
        dfs.watch(ROOTS[view], list);
      }
    });
  }
  const rows = Object.values(listed).flatMap((listing) => rowsOf(listing ?? {}));
  return shownRows(rows)
    .filter((row) => row.kind !== 'folder')
    .map((row) => ({ type: PICTURE, value: row.path, label: row.name, hint: modifiedOf(row), icon: pictureOf(row) }));
}

/**
 * Makes a new still of what's asked, in the folder open, and says where it is.
 *
 * @param ask - What to make.
 * @param prompt - The sent prompt.
 * @returns What came of it.
 */
async function makeNew(ask: string, prompt: PromptEvent) {
  try {
    const name = ask.length > NAME_LENGTH ? `${ask.slice(0, NAME_LENGTH).trimEnd()}…` : ask;
    const path = await makeStill(destination.folder, name, dockRequest(ask, mentionedIn(prompt)));
    if (!path) return 'No image came back from the model, so nothing was kept.';
    generation.references = [];
    return (
      <p>
        <strong>{name}</strong> is in Photos. <a href={linkTo('photos', path)}>Open it</a>.
      </p>
    );
  } catch (error) {
    return `Couldn't make it: ${(error as Error).message}`;
  }
}

/**
 * Makes new attempts of the still in front, asking what the prompt says.
 *
 * @param path - The still's path.
 * @param ask - What to make.
 * @param prompt - The sent prompt.
 * @returns What came of it.
 */
async function makeAgain(path: string, ask: string, prompt: PromptEvent) {
  const mentioned = mentionedIn(prompt);
  const attempts = await makeAttempts(path, { prompt: ask, ...(mentioned.length ? { references: mentioned } : {}) });
  if (attempts.length) return `Made ${attempts.length === 1 ? 'a new attempt' : `${attempts.length} new attempts`}.`;
  return `Couldn't make it: ${making[path]?.error}`;
}

/**
 * The pictures picked with `@` in a prompt.
 *
 * @param prompt - The sent prompt.
 * @returns Their paths.
 */
function mentionedIn({ selections }: PromptEvent): string[] {
  return selections.filter((item) => item.type === PICTURE).map((item) => item.value as string);
}

/**
 * What the prompt asks for, with the command and what's mentioned left out.
 *
 * @param prompt - The sent prompt.
 * @returns What to make.
 */
function askIn({ text, selections }: PromptEvent): string {
  return selections.reduce((rest, { label }) => rest.replace(`/${label}`, '').replace(`@${label}`, ''), text).trim();
}
