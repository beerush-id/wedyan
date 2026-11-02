import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, Show, Snippet, setup } from '@airlib/react';
import { DescriptionList, EmptyState, TextInput } from '@airlib/react-aui';
import { FolderIcon } from '@airlib/react-aui/icons';
import { BROWSE_CLASS } from '@/components/WedyanGallery.js';
import { openMotion } from '../composer/index.js';
import { ProjectsIcon } from '../icons.js';
import { duration, rename, shortDate } from '../motion.js';
import { libraryCtx, type MotionLibrary } from './context.js';
import { pictureOf, statusOf } from './listing.js';

/** The longest edge a picture is asked for at in the preview, as `dfs.image` serves it. */
const PREVIEW_SIZE = 512;

/** The picked project or folder, beside the tiles: its picture, its facts, and what it was asked to be. */
export const LibraryPreview = setup(() => {
  const library = libraryCtx.get() as MotionLibrary;
  const { state, enter } = library;
  const checked = () => (Array.isArray(state.picked) ? state.picked.length : 0);

  return () => (
    <aside className={`${BROWSE_CLASS.PREVIEW} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Preview">
      <Show
        when={() => library.selected}
        fallback={() => (
          <EmptyState
            title={checked() ? `${checked()} checked` : 'Nothing picked'}
            description={checked() ? 'Press Escape to pick one again.' : 'Pick a project to see it here.'}
            level={3}
          >
            <EmptyState.Snippet for="icon">{() => <ProjectsIcon />}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {(row) => {
          const project = row.kind === 'motion' ? row : undefined;
          // Made once: the name its button is labelled with changes the label alone.
          const picture = project ? <img src={pictureOf(project, PREVIEW_SIZE)} alt="" /> : <FolderIcon />;
          return (
            <>
              <Snippet data={() => row.name}>
                {(name) => (
                  <button
                    type="button"
                    className={BROWSE_CLASS.PREVIEW_OPEN}
                    aria-label={`Open ${name}`}
                    onClick={() => (project ? openMotion(row.path) : enter(row))}
                  >
                    {picture}
                  </button>
                )}
              </Snippet>
              <TextInput
                key={row.path}
                size="sm"
                label="Name"
                value={$bind(row, 'name')}
                autoFocus={state.renaming}
                onBlur={() => {
                  state.renaming = false;
                }}
                onchange={() => rename(row)}
                className="wedyan-rename"
              />
              {project && (
                <DescriptionList
                  size="sm"
                  items={[
                    { label: 'Length', value: duration(project.duration) },
                    { label: 'Status', value: statusOf(project) },
                    ...(project.updated ? [{ label: 'Updated', value: shortDate(project.updated) }] : []),
                  ]}
                />
              )}
              {project?.ask && <DescriptionList size="sm" layout="stacked" items={[{ label: 'Asked', value: project.ask }]} />}
            </>
          );
        }}
      </Show>
    </aside>
  );
}, 'LibraryPreview');
