import type { DockSuggestion } from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import type { Commands } from '@/lib/systems/public.js';
import FILES from '../data/files.json';
import { DocumentsIcon, MusicsIcon, PhotosIcon, VideosIcon } from './icons.js';

/** Each file kind's glyph; anything else reads as a document. */
const KIND_ICONS: Record<string, FC> = { image: PhotosIcon, video: VideosIcon, audio: MusicsIcon };

/** What Files can do, at `system.files.name`. */
export const COMMANDS: Commands = {};

/** What a request can mention while Files is in front: its files, a picture by itself, anything else by its kind's glyph. */
export const CONTEXTS: DockSuggestion[] = (FILES as Array<(typeof FILES)[number] & { src?: string }>).map((file) => {
  const Icon = KIND_ICONS[file.kind] ?? DocumentsIcon;
  return { value: file.id, label: file.name, hint: file.size, icon: file.src ?? <Icon /> };
});
