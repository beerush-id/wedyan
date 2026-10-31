import type { DockSuggestion, DockSuggestions } from '@airlib/react-aui/desktop';
import { type CommandSuggestion, commandSuggestions, windowContexts } from './registry.js';

/**
 * What the prompt offers: `/` for what can be run, the front window's commands first, then the apps'
 * and Wedyan's, each set after a gap; `@` for what the last command before it is about, or else what
 * the front window lets a request mention.
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
    return match(about?.contexts?.() ?? windowContexts(), query);
  }
  return [];
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
