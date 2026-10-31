import { $bind, $use, Show, setup } from '@airlib/react';
import { Button, EmptyState, Spinner } from '@airlib/react-aui';
import { IRPC_STATUS } from '@irpclib/irpc';
import { BROWSE_CLASS, WedyanGallery, type WedyanGalleryEntry } from '@/components/WedyanGallery.js';
import { focusPrompt } from '@/lib/systems/focus.js';
import { openMotion } from '../composer/Window.js';
import { AddIcon, ProjectsIcon } from '../icons.js';
import { libraryCtx, type MotionLibrary } from './context.js';
import { VIEW_LABELS } from './listing.js';
import { LibraryPreview } from './Preview.js';

const EMPTY_CLASS = 'wedyan-motions-empty';

/** What the library says while its listing is on the way. */
const LOADING = 'Loading your motions';

/** What's listed as tiles or rows, the picked one's preview beside; or why there's nothing to list. */
export const LibrarySheet = setup(() => {
  const { state, items, tiles } = libraryCtx.get() as MotionLibrary;
  const pending = () => items.status === IRPC_STATUS.PENDING;

  /** A tile opens where it belongs: a folder here, a project in a window of its own. */
  const open = (tile: WedyanGalleryEntry) => {
    if (tile.kind === 'folder') state.folder = tile.path;
    else openMotion(tile.path);
  };

  return () => (
    <Show
      when={() => tiles().length}
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
                  <Button size="sm" variant="filled" onClick={() => state.version++}>
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
            entries={$use(tiles)}
            value={$bind(state, 'picked')}
            multiple={$bind(state, 'several')}
            layout={$use(() => state.viewMode)}
            query={$use(() => state.query)}
            checkable
            className={BROWSE_CLASS.GALLERY}
            onopen={open}
          />
          <Show when={() => state.previewShown}>{() => <LibraryPreview />}</Show>
        </div>
      )}
    </Show>
  );
}, 'LibrarySheet');
