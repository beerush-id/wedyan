import { Show, setup } from '@airlib/react';
import { deleteConfirm } from '@/components/confirm.js';
import { DeleteIcon, DownloadIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { openMotion } from '../composer/Window.js';
import { ComposeIcon, DirectIcon } from '../icons.js';
import { removeEntries } from '../motion.js';
import { libraryCtx, type MotionLibrary } from './context.js';

/** What can be done with what's picked, beside the title. */
export const LibrarySelection = setup(() => {
  const { state } = libraryCtx.get() as MotionLibrary;
  const paths = (): string[] => (Array.isArray(state.picked) ? state.picked : state.picked ? [state.picked] : []);

  const remove = () => {
    const picked = paths();
    Object.assign(state, { several: false, picked: null });
    void removeEntries(picked);
  };

  const groups = (): SelectionAction[][] => {
    const [one] = paths();
    return [
      ...(state.several
        ? []
        : [
            [
              { label: 'Open in Direct', icon: <DirectIcon />, run: () => openMotion(one, true) },
              { label: 'Open in Compose', icon: <ComposeIcon />, run: () => openMotion(one) },
            ],
          ]),
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
