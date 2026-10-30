import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { whenOf } from './dates.js';
import { LibraryIcon } from './icons.js';
import { EVENTS } from './library.js';

/** What Calendar adds to the prompt's commands while it's in front: nothing of its own yet. */
export const COMMANDS: DockSuggestion[] = [];

/** What a request can mention while Calendar is in front: its events, each by its summary and when it is. */
export const CONTEXTS: DockSuggestion[] = EVENTS.map((event) => ({
  value: event.path,
  label: event.summary,
  hint: whenOf(event),
  icon: <LibraryIcon />,
}));
