import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { AgentsIcon, PeopleIcon } from './icons.js';
import { agents, KINDS, people, skillsOf } from './library.js';

/** What a request can mention while Lounge is in front: its people by their kind, and its agents by their skills. */
export const CONTEXTS: DockSuggestion[] = [
  ...people().map(({ path, document }) => ({
    value: path,
    label: document.name,
    hint: KINDS[document.kind],
    icon: <PeopleIcon />,
  })),
  ...agents().map(({ path, document }) => ({
    value: path,
    label: document.name,
    hint: skillsOf(document),
    icon: <AgentsIcon />,
  })),
];
