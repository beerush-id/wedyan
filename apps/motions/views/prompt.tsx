import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { generateMotion } from '@/lib/assistant/mock.js';
import type { Commands } from '@/lib/systems/public.js';
import { GenerativeIcon } from './icons.js';

/** What a request can mention while Motions is in front. */
export const CONTEXTS: DockSuggestion[] = [];

/** What Motions can do, at `system.motions.name`. */
export const COMMANDS: Commands = {
  animate: { hint: 'Make a motion', icon: <GenerativeIcon />, handle: (input) => generateMotion(input) },
};
