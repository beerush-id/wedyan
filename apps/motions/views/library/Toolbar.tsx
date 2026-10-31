import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, Show, Snippet, setup } from '@airlib/react';
import { Button, Divider, Toggle, Tooltip } from '@airlib/react-aui';
import { WindowControls, WindowTitle, WindowToolbar } from '@airlib/react-aui/desktop';
import { ArrowLeft } from '@airlib/react-aui/icons';
import { PreviewPanelIcon } from '@/components/icons.js';
import { WedyanGalleryLayoutToggle, WedyanGallerySearch } from '@/components/WedyanGallery.js';
import { focusPrompt } from '@/lib/systems/focus.js';
import { AddIcon, NewFolderIcon, SidebarCloseIcon, SidebarOpenIcon } from '../icons.js';
import { newFolder, ROOT } from '../motion.js';
import { libraryCtx, type MotionLibrary } from './context.js';
import { VIEW_LABELS } from './listing.js';
import { LibrarySelection } from './Selection.js';

/** The library's toolbar: where it is, what can be done with what's picked, and how it's shown. */
export const LibraryToolbar = setup(() => {
  const { state, up, add } = libraryCtx.get() as MotionLibrary;
  const inFolder = () => state.activeView === 'all' && state.folder !== ROOT;
  const title = () => (inFolder() ? state.trail.at(-1)?.name : VIEW_LABELS[state.activeView]);

  // A new folder is named right away: it's picked, with its name in the preview, ready to type.
  const addFolder = () => {
    const row = newFolder(state.folder, 'New folder');
    add(row);
    Object.assign(state, { picked: row.path, several: false, previewShown: true, renaming: true });
  };

  return () => (
    <WindowToolbar>
      <Show when={inFolder}>
        {() => (
          <>
            <Button aria-label="Up a folder" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={up}>
              <ArrowLeft />
            </Button>
            <Divider orientation="vertical" variant="ghost" size="sm" />
          </>
        )}
      </Show>
      <Toggle aria-label="Hide sidebar" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(state, 'sidebarHidden')}>
        <Snippet>{() => (state.sidebarHidden ? <SidebarOpenIcon /> : <SidebarCloseIcon />)}</Snippet>
        <Tooltip>Hide sidebar</Tooltip>
      </Toggle>
      <WindowTitle>
        <Snippet>{title}</Snippet>
      </WindowTitle>
      <LibrarySelection />
      <WindowControls>
        <WedyanGallerySearch query={$bind(state, 'query')} />
        <Divider orientation="vertical" variant="ghost" size="sm" />
        {/* Starting a motion is asking Wedyan for one, so it puts the caret in the prompt, the dock's tools for it beside. */}
        <Button aria-label="New motion" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={focusPrompt}>
          <AddIcon />
          <Tooltip>New motion</Tooltip>
        </Button>
        {/* Folders are made where folders are: not in what's gathered from all of them. */}
        <Show when={() => state.activeView === 'all'}>
          {() => (
            <Button aria-label="New folder" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={addFolder}>
              <NewFolderIcon />
              <Tooltip>New folder</Tooltip>
            </Button>
          )}
        </Show>
        <Divider orientation="vertical" variant="ghost" size="sm" />
        <WedyanGalleryLayoutToggle layout={$bind(state, 'viewMode')} />
        <Toggle aria-label="Preview" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(state, 'previewShown')}>
          <PreviewPanelIcon />
          <Tooltip>Preview</Tooltip>
        </Toggle>
        {/* Sets the app's own buttons apart from the window's. */}
        <Divider orientation="vertical" variant="ghost" size="sm" />
      </WindowControls>
    </WindowToolbar>
  );
}, 'LibraryToolbar');
