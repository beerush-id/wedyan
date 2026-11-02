import type { DockSuggestion } from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import { rowsOf, sizeOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import type { Commands } from '@/lib/systems/public.js';
import { shown } from './context.js';
import { DocumentsIcon, MusicsIcon, PhotosIcon, VideosIcon } from './icons.js';

/** Each file kind's glyph; anything else reads as a document. */
const KIND_ICONS: Record<string, FC> = { image: PhotosIcon, video: VideosIcon, audio: MusicsIcon };

/** The longest edge a picture is shown at in a suggestion, as `dfs.image` serves it. */
const SUGGESTION_SIZE = 64;

/** What Files can do, at `system.files.name`. */
export const COMMANDS: Commands = {};

/**
 * What a request can mention while Files is in front: the files in the folder open, a picture by
 * itself, anything else by its kind's glyph.
 *
 * @returns One suggestion each, by its path in the home.
 */
export function contexts(): DockSuggestion[] {
  return rowsOf(shown.files?.items ?? {})
    .filter((row) => !row.isDirectory)
    .map((row) => {
      const Icon = KIND_ICONS[row.kind] ?? DocumentsIcon;
      return {
        value: row.path,
        label: row.name,
        hint: sizeOf(row.size),
        icon: row.kind === 'image' ? dfs.image(row.path, { size: SUGGESTION_SIZE }) : <Icon />,
      };
    });
}
