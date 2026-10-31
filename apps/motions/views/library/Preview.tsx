import { AUI_CLASS } from '@airlib/aui/utils';
import { Show, setup } from '@airlib/react';
import { DescriptionList, EmptyState } from '@airlib/react-aui';
import { FolderIcon } from '@airlib/react-aui/icons';
import { BROWSE_CLASS } from '@/components/WedyanGallery.js';
import { openMotion } from '../composer/Window.js';
import { ProjectsIcon } from '../icons.js';
import { duration, shortDate } from '../motion.js';
import { libraryCtx, type MotionLibrary } from './context.js';
import { statusOf } from './listing.js';

/** The picked project or folder, beside the tiles: its picture, its facts, and what it was asked to be. */
export const LibraryPreview = setup(() => {
  const { state, tiles, rows } = libraryCtx.get() as MotionLibrary;
  const picked = () => tiles().find((tile) => tile.path === state.picked);
  const checked = () => (Array.isArray(state.picked) ? state.picked.length : 0);

  const open = (path: string, isFolder: boolean) => {
    if (isFolder) state.folder = path;
    else openMotion(path);
  };

  return () => (
    <aside className={`${BROWSE_CLASS.PREVIEW} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Preview">
      <Show
        when={picked}
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
        {(tile) => {
          const project = rows().find((row) => row.kind === 'motion' && row.path === tile.path);
          return (
            <>
              <button
                type="button"
                className={BROWSE_CLASS.PREVIEW_OPEN}
                aria-label={`Open ${tile.name}`}
                onClick={() => open(tile.path, !project)}
              >
                {project ? <img src={project.thumbnail} alt="" /> : <FolderIcon />}
              </button>
              <h3 className={BROWSE_CLASS.PREVIEW_NAME}>{tile.name}</h3>
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
