import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { GenerativeIcon } from './icons.js';
import { projects, shortDate } from './library.js';

/** What Motions adds to the prompt's commands while it's in front. */
export const COMMANDS: DockSuggestion[] = [
  { value: 'animate', label: 'animate', hint: 'Make a motion', icon: <GenerativeIcon /> },
];

/** What a request can mention while Motions is in front: its projects, each shown by its cover. */
export const CONTEXTS: DockSuggestion[] = projects().map((project) => ({
  value: project.path,
  label: project.document.name,
  hint: shortDate(project.document.updated),
  icon: project.document.cover,
}));
