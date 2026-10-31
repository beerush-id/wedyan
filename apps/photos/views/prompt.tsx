import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { generateImages } from '@/lib/assistant/mock.js';
import type { Commands } from '@/lib/systems/public.js';
import { GenerativeIcon } from './icons.js';
import { PHOTOS } from './library.js';

/** What Photos can do, at `system.photos.name`. */
export const COMMANDS: Commands = {
  generate: { hint: 'Make an image', icon: <GenerativeIcon />, handle: (input) => generateImages(input) },
};

/** What a request can mention while Photos is in front: its photos, each shown by its own picture. */
export const CONTEXTS: DockSuggestion[] = PHOTOS.map((photo) => ({
  value: photo.id,
  label: photo.name,
  hint: photo.modified,
  icon: photo.src,
}));
