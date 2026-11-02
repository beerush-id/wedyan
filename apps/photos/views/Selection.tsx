import { $use, Show, setup } from '@airlib/react';
import { DeleteIcon, DownloadIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { downloadImage } from '@/lib/systems/download.js';
import { ReferenceIcon } from './icons.js';
import { libraryCtx, type PhotoLibrary } from './library.js';
import { originalOf, pictureOf } from './listing.js';
import { generation, MAX_REFERENCES } from './making.js';

/** What can be done with what's picked, beside the title. */
export const LibrarySelection = setup(() => {
  const library = libraryCtx.get() as PhotoLibrary;
  const { state, picks } = library;

  // What's pressed reads the rows it works on then; only what's picked is watched here.
  const groups: SelectionAction[][] = [
    [{ label: 'Use as reference', icon: <ReferenceIcon />, run: () => reference(picks()) }],
    [{ label: 'Download', icon: <DownloadIcon />, run: () => download(picks()) }],
    [{ label: 'Delete', icon: <DeleteIcon />, run: () => void library.remove() }],
  ];

  return () => (
    <Show when={() => [state.picked].flat().filter(Boolean).length > 0}>
      {() => <SelectionActions label="Picked photos" count={$use(() => (state.several ? `${[state.picked].flat().length} selected` : undefined))} groups={groups} />}
    </Show>
  );
}, 'LibrarySelection');

/**
 * Hands pictures to the next generation as references, after any already there. A still with
 * nothing made yet has no picture to hand on.
 *
 * @param rows - The pictures.
 */
function reference(rows: FileRow[]): void {
  const added = rows
    .filter((row) => originalOf(row) && !generation.references.some(({ path }) => path === row.path))
    .map((row) => ({ path: row.path, name: row.name, picture: pictureOf(row) }));
  generation.references = [...generation.references, ...added].slice(0, MAX_REFERENCES);
}

/**
 * Saves pictures from the drive to the user's computer, each named after what it's called.
 *
 * @param rows - The pictures.
 */
function download(rows: FileRow[]): void {
  for (const row of rows) {
    const src = originalOf(row);
    if (src) void downloadImage(src, row.name);
  }
}
