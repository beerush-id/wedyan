import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { shown } from './context.js';
import { AgentsIcon, PeopleIcon } from './icons.js';

/**
 * What a request can mention while Lounge is in front: the people and agents its window lists.
 *
 * @returns One suggestion each, by its path in the home.
 */
export function contexts(): DockSuggestion[] {
  const { lounge } = shown;
  if (!lounge) return [];
  return [
    ...lounge.rows('people').map(({ path, name, description }) => ({ value: path, label: name, hint: description, icon: <PeopleIcon /> })),
    ...lounge.rows('agents').map(({ path, name, description }) => ({ value: path, label: name, hint: description, icon: <AgentsIcon /> })),
  ];
}
