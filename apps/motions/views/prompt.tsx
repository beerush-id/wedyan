import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { generateMotion } from '@/lib/assistant/mock.js';
import type { Commands } from '@/lib/systems/public.js';
import { GenerativeIcon } from './icons.js';
import { projects, shortDate } from './library.js';

/** What Motions can do, at `system.motions.name`. */
export const COMMANDS: Commands = {
  animate: { hint: 'Make a motion', icon: <GenerativeIcon />, handle: (input) => generateMotion(input) },
};

/** What a request can mention while Motions is in front: its projects, each shown by its cover. */
export const CONTEXTS: DockSuggestion[] = projects().map((project) => ({
  value: project.path,
  label: project.document.name,
  hint: shortDate(project.document.updated),
  icon: project.document.cover,
}));
