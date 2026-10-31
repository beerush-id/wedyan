import { Show, setup } from '@airlib/react';
import { deleteConfirm } from '@/components/confirm.js';
import { DeleteIcon, DownloadIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { openMotion } from '../composer/index.js';
import { ComposeIcon, DirectIcon, EditIcon } from '../icons.js';
import { removeEntries } from '../motion.js';
import { libraryCtx, type MotionLibrary } from './context.js';

/** What can be done with what's picked, beside the title. */
export const LibrarySelection = setup(() => {
  const { state, tiles } = libraryCtx.get() as MotionLibrary;
  const paths = (): string[] => (Array.isArray(state.picked) ? state.picked : state.picked ? [state.picked] : []);
  const isProject = (path: string) => tiles().find((tile) => tile.path === path)?.kind === 'motion';

  const remove = () => {
    const picked = paths();
    Object.assign(state, { several: false, picked: null });
    void removeEntries(picked);
  };

  const groups = (): SelectionAction[][] => {
    const [one] = paths();
    return [
      ...(!state.several && isProject(one)
        ? [
            [
              { label: 'Open in Direct', icon: <DirectIcon />, run: () => openMotion(one, true) },
              { label: 'Open in Compose', icon: <ComposeIcon />, run: () => openMotion(one) },
            ],
          ]
        : []),
      ...(state.several ? [] : [[{ label: 'Rename', icon: <EditIcon />, run: () => Object.assign(state, { previewShown: true, renaming: true }) }]]),
      [
        { label: 'Share', icon: <ShareIcon /> },
        { label: 'Download', icon: <DownloadIcon /> },
      ],
      [{ label: 'Delete', icon: <DeleteIcon />, run: remove, confirm: deleteConfirm(paths().length, 'item', 'items', 'your drive') }],
    ];
  };

  return () => (
    <Show when={() => paths().length > 0}>
      {() => (
        <SelectionActions label="Picked projects" count={state.several ? `${paths().length} selected` : undefined} groups={groups()} />
      )}
    </Show>
  );
}, 'LibrarySelection');
