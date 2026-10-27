import type { DockReference, DockSuggestion, DockSuggestionFilters } from '@airlib/react-aui/desktop';
import { SYSTEM } from './boot.js';
import { COMMANDS, type PromptCommand } from './commands.js';

/**
 * The prompt's suggestions: `/` for Wedyan's commands, then after a gap the front window's; `@` for
 * what the last command before it is about, or else what the front window lets a request mention.
 */
export const PROMPT_FILTERS: DockSuggestionFilters = {
  '/': (query) => [...match(COMMANDS, query), ...match(SYSTEM?.activeWindow?.commands ?? [], query)],
  '@': (query, { references }) => match(lastCommand(references)?.contexts?.() ?? SYSTEM?.activeWindow?.contexts ?? [], query),
};

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

/**
 * The last command picked into the prompt.
 *
 * @param references - What was picked, in order.
 * @returns The last `/` pick, if any.
 */
function lastCommand(references: DockReference[]): PromptCommand | undefined {
  return references.filter((reference) => reference.char === '/').at(-1)?.item as PromptCommand | undefined;
}
