import { AUI_CLASS } from '@airlib/aui/utils';
import { Show, setup, template } from '@airlib/react';
import { DescriptionList, EmptyState } from '@airlib/react-aui';
import { FloatingDownload } from '@/components/FloatingDownload.js';
import { BROWSE_CLASS } from '@/components/WedyanGallery.js';
import { type FileRow, shortDate, sizeOf } from '@/lib/documents/rows.js';
import type { StillDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { LibraryIcon } from './icons.js';
import { libraryCtx, type PhotoLibrary } from './library.js';
import { modifiedOf, originalOf, pictureOf } from './listing.js';

const PICTURE_CLASS = 'wedyan-photos-preview-picture';

/** How large the preview asks for its picture, its longest edge. */
const PREVIEW_SIZE = 512;

/** The picked file, beside the tiles: its picture, its facts, and what it was asked to be. */
export const LibraryPreview = setup(() => {
  const library = libraryCtx.get() as PhotoLibrary;
  const { state, open } = library;
  const checked = () => (Array.isArray(state.picked) ? state.picked.length : 0);

  return () => (
    <aside className={`${BROWSE_CLASS.PREVIEW} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Preview">
      <Show
        when={() => (state.several ? undefined : library.picks()[0])}
        fallback={() => (
          <EmptyState
            title={checked() ? `${checked()} checked` : 'Nothing picked'}
            description={checked() ? 'Press Escape to pick one again.' : 'Pick a photo to see it here.'}
            level={3}
          >
            <EmptyState.Snippet for="icon">{() => <LibraryIcon />}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {(row) => {
          const original = originalOf(row);
          return (
            <>
              {/* The picture opens what's picked; downloading it floats at its corner, beside, not inside. */}
              <div className={PICTURE_CLASS}>
                <button type="button" className={BROWSE_CLASS.PREVIEW_OPEN} aria-label={`Open ${row.name}`} onClick={() => open(row)}>
                  <img src={pictureOf(row, PREVIEW_SIZE)} alt="" />
                </button>
                {original && <FloatingDownload src={original} name={row.name} />}
              </div>
              <h3 className={BROWSE_CLASS.PREVIEW_NAME}>{row.name}</h3>
              {row.kind === 'image' && <ImageFacts row={row} />}
              {row.kind === 'still' && <StillFacts path={row.path} />}
            </>
          );
        }}
      </Show>
    </aside>
  );
}, 'LibraryPreview');

/** An image's facts, which its row holds. */
const ImageFacts = template<{ row: FileRow }>(
  ({ row }) => (
    <DescriptionList
      size="sm"
      items={[
        { label: 'Size', value: sizeOf(row.size) },
        { label: 'Date', value: modifiedOf(row) ?? '' },
      ]}
    />
  ),
  'ImageFacts'
);

/** A still's facts, which only its document holds: how many attempts it has, and what it was asked to be. */
const StillFacts = setup<{ path: string }>((props) => {
  const still = () => dfs.read<StillDocument>(props.path).data;

  return () => (
    <Show when={still}>
      {(document) => (
        <>
          <DescriptionList
            size="sm"
            items={[
              { label: 'Attempts', value: String(document.attempts.length) },
              { label: 'Updated', value: shortDate(document.updated) },
            ]}
          />
          {document.prompt && <DescriptionList size="sm" layout="stacked" items={[{ label: 'Prompt', value: document.prompt }]} />}
        </>
      )}
    </Show>
  );
}, 'StillFacts');
