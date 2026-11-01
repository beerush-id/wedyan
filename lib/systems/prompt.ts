import { mutable } from '@airlib/react';
import type { DockSuggestion, DockSuggestions } from '@airlib/react-aui/desktop';
import { homePath } from '@/lib/documents/paths.js';
import { rowsOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { type CommandSuggestion, commandSuggestions, windowContexts } from './registry.js';

/** How long, in ms, typing rests before `@` searches the drive. */
const SEARCH_WAIT = 200;

/** The most files `@` offers. */
const FILE_LIMIT = 8;

/** The search `@` reads, replaced whole as the query changes. */
const found = mutable({ files: undefined as ReturnType<typeof dfs.search> | undefined }, { recursive: false });

let asked = '';
let waiting: ReturnType<typeof setTimeout> | undefined;

/**
 * What the prompt offers: `/` for what can be run, the front window's commands first, then the apps'
 * and Wedyan's, each set after a gap; `@` for what the last command before it is about, or else what
 * the front window lets a request mention, then the drive's files.
 *
 * @param word - The word being typed.
 * @param selections - What was picked earlier in the prompt.
 * @returns What to offer.
 */
export const promptSuggestions: DockSuggestions = ({ key, query }, selections) => {
  if (key === '/') {
    const commands = commandSuggestions();
    return [...new Set(commands.map((command) => command.group))].flatMap((group) =>
      match(
        commands.filter((command) => command.group === group),
        query
      )
    );
  }
  if (key === '@') {
    const about = selections.filter((item) => item.type === 'command').at(-1) as CommandSuggestion | undefined;
    if (about?.contexts) return match(about.contexts(), query);
    return [...match(windowContexts(), query), ...files(query)];
  }
  return [];
};

/**
 * The drive's files matching the query, as `@` offers them. A search is asked once typing rests, and
 * what reads this only follows it, filling in as it arrives.
 *
 * @param query - What's typed after the `@`.
 * @returns The files found, each with its path as its value; none until something is typed.
 */
function files(query: string): DockSuggestion[] {
  if (query !== asked) {
    asked = query;
    clearTimeout(waiting);
    // Outside whoever's reading: a search outlives what's drawn, and asking isn't a read.
    waiting = setTimeout(() => {
      found.files = query ? dfs.search(query, { limit: FILE_LIMIT }) : undefined;
    }, SEARCH_WAIT);
  }
  if (!query) return [];
  return rowsOf(found.files ?? {}).map(({ path, name, metadata }) => ({
    type: 'file',
    value: homePath(path),
    label: (metadata?.title as string | undefined) ?? name,
    hint: homePath(path),
    group: 'Files',
  }));
}

/**
 * The items whose label contains the query, ignoring case, best matches — those starting with it —
 * first, and at most eight.
 *
 * @param items - The items to search.
 * @param query - What's typed after the trigger character.
 * @returns The matching items.
 */
function match(items: DockSuggestion[], query: string): DockSuggestion[] {
  const needle = query.toLowerCase();
  const found = items.filter((item) => item.label.toLowerCase().includes(needle));
  const starts = (item: DockSuggestion) => (item.label.toLowerCase().startsWith(needle) ? 0 : 1);
  return found.sort((a, b) => starts(a) - starts(b)).slice(0, 8);
}
