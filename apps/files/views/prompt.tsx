import type { DockSuggestion } from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import FILES from '../data/files.json';
import { DocumentsIcon, MusicsIcon, PhotosIcon, SearchIcon, VideosIcon } from './icons.js';

/** Each file kind's glyph; anything else reads as a document. */
const KIND_ICONS: Record<string, FC> = { image: PhotosIcon, video: VideosIcon, audio: MusicsIcon };

/** What Files adds to the prompt's commands while it's in front. */
export const COMMANDS: DockSuggestion[] = [
  { value: 'search', label: 'search', hint: 'Find a file', icon: <SearchIcon /> },
];

/** What a request can mention while Files is in front: its files, a picture by itself, anything else by its kind's glyph. */
export const CONTEXTS: DockSuggestion[] = (FILES as Array<(typeof FILES)[number] & { src?: string }>).map((file) => {
  const Icon = KIND_ICONS[file.kind] ?? DocumentsIcon;
  return { value: file.id, label: file.name, hint: file.size, icon: file.src ?? <Icon /> };
});
