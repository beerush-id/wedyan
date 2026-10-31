import { $bind, $use, Show, setup, template } from '@airlib/react';
import { Button, EmptyState, GalleryItem, Spinner } from '@airlib/react-aui';
import { IRPC_STATUS } from '@irpclib/irpc';
import { BROWSE_CLASS, WedyanGallery, WedyanGalleryRow } from '@/components/WedyanGallery.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { focusPrompt } from '@/lib/systems/focus.js';
import { openMotion } from '../composer/index.js';
import { AddIcon, ProjectsIcon } from '../icons.js';
import { libraryCtx, type MotionLibrary } from './context.js';
import { detailOf, modifiedOf, pictureOf, VIEW_LABELS } from './listing.js';
import { LibraryPreview } from './Preview.js';

const EMPTY_CLASS = 'wedyan-motions-empty';

/** What the library says while its listing is on the way. */
const LOADING = 'Loading your motions';

/** What's listed as tiles or rows, the picked one's preview beside; or why there's nothing to list. */
export const LibrarySheet = setup(() => {
  const { state, items, rows, enter } = libraryCtx.get() as MotionLibrary;
  const pending = () => items.status === IRPC_STATUS.PENDING;

  /** A row opens where it belongs: a folder here, a project in a window of its own. */
  const open = (row: FileRow) => {
    if (row.kind === 'folder') enter(row);
    else openMotion(row.path);
  };

  return () => (
    <Show
      when={() => items.data?.entries.length}
      fallback={() => (
        <EmptyState
          className={EMPTY_CLASS}
          title={$use(() => (pending() ? LOADING : items.error ? "Couldn't load your motions" : 'No motions yet'))}
          description={$use(() => (pending() ? undefined : (items.error?.message ?? 'Ask Wedyan for one, and it starts here.')))}
        >
          <EmptyState.Snippet for="icon">{() => (pending() ? <Spinner label={LOADING} /> : <ProjectsIcon />)}</EmptyState.Snippet>
          <EmptyState.Snippet for="action">
            {() => {
              if (pending()) return '';
              if (items.error) {
                return (
                  <Button size="sm" variant="filled" onClick={() => state.asked++}>
                    Try again
                  </Button>
                );
              }
              return (
                <Button size="sm" variant="filled" onClick={focusPrompt}>
                  <AddIcon />
                  <span>New motion</span>
                </Button>
              );
            }}
          </EmptyState.Snippet>
        </EmptyState>
      )}
    >
      {() => (
        <div className={BROWSE_CLASS.ROOT}>
          <WedyanGallery
            label={$use(() => VIEW_LABELS[state.activeView])}
            entries={$use(rows)}
            value={$bind(state, 'picked')}
            multiple={$bind(state, 'several')}
            layout={$use(() => state.viewMode)}
            query={$use(() => state.query)}
            checkable
            className={BROWSE_CLASS.GALLERY}
            onopen={open}
          >
            <WedyanGallery.Snippet for="tile">{(row: FileRow) => <LibraryTile row={row} />}</WedyanGallery.Snippet>
            <WedyanGallery.Snippet for="row">{(row: FileRow) => <LibraryRow row={row} />}</WedyanGallery.Snippet>
          </WedyanGallery>
          <Show when={() => state.previewShown}>{() => <LibraryPreview />}</Show>
        </div>
      )}
    </Show>
  );
}, 'LibrarySheet');

/** One listed row as a tile, the only thing that reads it. */
const LibraryTile = template<{ row: FileRow }>(
  ({ row }) => (
    <GalleryItem
      value={row.path}
      src={pictureOf(row)}
      alt={row.name}
      title={row.name}
      description={detailOf(row)}
      meta={modifiedOf(row)}
    />
  ),
  'LibraryTile'
);

/** One listed row in the list layout, the only thing that reads it. */
const LibraryRow = template<{ row: FileRow }>(
  ({ row }) => (
    <WedyanGalleryRow value={row.path} src={pictureOf(row)} title={row.name} description={detailOf(row)} meta={modifiedOf(row)} />
  ),
  'LibraryRow'
);
