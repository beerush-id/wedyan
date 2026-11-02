import { $bind, $use, Show, setup, template } from '@airlib/react';
import { Button, EmptyState, GalleryItem, ImageViewer, type ImageViewerEntry, Spinner } from '@airlib/react-aui';
import { AddIcon } from '@airlib/react-aui/icons';
import { IRPC_STATUS } from '@irpclib/irpc';
import { BROWSE_CLASS, WedyanGallery, WedyanGalleryRow } from '@/components/WedyanGallery.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { LibraryIcon } from './icons.js';
import { libraryCtx, type PhotoLibrary } from './library.js';
import { detailOf, modifiedOf, originalOf, pictureOf, VIEWER_LABELS } from './listing.js';
import { LibraryPreview } from './Preview.js';

/** What the browser says while its listing is on the way. */
const LOADING = 'Loading your photos';

/** What the browser shows: the images in the viewer, or what's listed. */
export const LibrarySheet = setup(() => {
  const library = libraryCtx.get() as PhotoLibrary;
  const { state, images } = library;

  // Stepping through the viewer moves the pick along, so going back lands on the last one seen.
  const step = (event: CustomEvent<number>) => {
    if (!state.several) state.picked = images()[event.detail]?.path ?? null;
  };

  return () => (
    <Show when={() => state.viewing} fallback={() => <LibraryFiles />}>
      {() => <ImageViewer label={library.title} items={$use(() => images().map(slideOf))} index={$bind(state, 'index')} labels={VIEWER_LABELS} onchange={step} />}
    </Show>
  );
}, 'LibrarySheet');

/** What's listed as tiles or rows, the picked one's preview beside; or why there's nothing to list. */
const LibraryFiles = setup(() => {
  const library = libraryCtx.get() as PhotoLibrary;
  const { state, items, rows, open, create } = library;
  const pending = () => items.status === IRPC_STATUS.PENDING;

  return () => (
    <Show
      when={() => rows().length}
      fallback={() => (
        <EmptyState
          title={$use(() => (pending() ? LOADING : items.error ? "Couldn't load your photos" : 'Nothing here yet'))}
          description={$use(() => (pending() ? undefined : (items.error?.message ?? 'Describe an image to Wedyan, and it arrives here.')))}
        >
          <EmptyState.Snippet for="icon">{() => (pending() ? <Spinner label={LOADING} /> : <LibraryIcon />)}</EmptyState.Snippet>
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
                <Button size="sm" variant="filled" disabled={$use(() => state.creating)} onClick={create}>
                  <AddIcon />
                  <span>New still project</span>
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
            label={$use(() => library.title)}
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
}, 'LibraryFiles');

/** One listed row as a tile, the only thing that reads it. */
const LibraryTile = template<{ row: FileRow }>(
  ({ row }) => <GalleryItem value={row.path} src={pictureOf(row)} alt={row.name} title={row.name} description={detailOf(row)} meta={modifiedOf(row)} />,
  'LibraryTile'
);

/** One listed row in the list layout, the only thing that reads it. */
const LibraryRow = template<{ row: FileRow }>(
  ({ row }) => <WedyanGalleryRow value={row.path} src={pictureOf(row)} title={row.name} description={detailOf(row)} meta={modifiedOf(row)} />,
  'LibraryRow'
);

/**
 * An image as one of the viewer's, captioned with its name and date.
 *
 * @param row - The image to show.
 * @returns The viewer's entry.
 */
function slideOf(row: FileRow): ImageViewerEntry {
  return { src: originalOf(row) as string, alt: row.name, caption: `${row.name} · ${modifiedOf(row)}` };
}
