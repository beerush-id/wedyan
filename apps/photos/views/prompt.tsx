import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { GenerativeIcon } from './icons.js';
import { PHOTOS } from './library.js';

/** What Photos adds to the prompt's commands while it's in front. */
export const COMMANDS: DockSuggestion[] = [
  { value: 'generate', label: 'generate', hint: 'Make an image', icon: <GenerativeIcon /> },
];

/** What a request can mention while Photos is in front: its photos, each shown by its own picture. */
export const CONTEXTS: DockSuggestion[] = PHOTOS.map((photo) => ({
  value: photo.id,
  label: photo.name,
  hint: photo.modified,
  icon: photo.src,
}));
