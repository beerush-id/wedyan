import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, Show, Snippet, setup } from '@airlib/react';
import { Button, Divider, Toggle, Tooltip } from '@airlib/react-aui';
import { WindowControls, WindowTitle, WindowToolbar } from '@airlib/react-aui/desktop';
import { AddIcon, ArrowLeft } from '@airlib/react-aui/icons';
import { PreviewPanelIcon, SidebarCloseIcon, SidebarOpenIcon } from '@/components/icons.js';
import { WedyanGalleryLayoutToggle, WedyanGallerySearch } from '@/components/WedyanGallery.js';
import { libraryCtx, type PhotoLibrary } from './library.js';
import { LibrarySelection } from './Selection.js';

/** The browser's toolbar: where it is, what can be done with what's picked, and how it's shown. */
export const LibraryToolbar = setup(() => {
  const library = libraryCtx.get() as PhotoLibrary;
  const { state, up, create } = library;

  // Going back: from the viewer to the tiles, otherwise up a folder.
  const back = () => {
    if (state.viewing) state.viewing = false;
    else up();
  };

  return () => (
    <WindowToolbar>
      {/* Going back leads, set apart from the view it leaves: its sidebar and where it is. */}
      <Show when={() => state.viewing || library.inFolder}>
        {() => (
          <>
            <Button
              aria-label={$use(() => (state.viewing ? 'Back to the tiles' : 'Up a folder'))}
              size="sm"
              variant="text"
              className={AUI_CLASS.CONTROL_ICON}
              onClick={back}
            >
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
        <Snippet>{() => library.title}</Snippet>
      </WindowTitle>
      {/* While things are picked, what can be done with them sits beside the title. */}
      <Show when={() => !state.viewing}>{() => <LibrarySelection />}</Show>
      <WindowControls>
        <Show when={() => !state.viewing}>
          {() => (
            <>
              <WedyanGallerySearch query={$bind(state, 'query')} />
              <Divider orientation="vertical" variant="ghost" size="sm" />
              <Button
                aria-label="New still project"
                size="sm"
                variant="text"
                className={AUI_CLASS.CONTROL_ICON}
                disabled={$use(() => state.creating)}
                onClick={create}
              >
                <AddIcon />
                <Tooltip>New still project</Tooltip>
              </Button>
              {/* Making something apart from how the files show. */}
              <Divider orientation="vertical" variant="ghost" size="sm" />
              <WedyanGalleryLayoutToggle layout={$bind(state, 'viewMode')} />
              <Toggle aria-label="Preview" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(state, 'previewShown')}>
                <PreviewPanelIcon />
                <Tooltip>Preview</Tooltip>
              </Toggle>
              {/* Sets the app's own buttons apart from the window's. */}
              <Divider orientation="vertical" variant="ghost" size="sm" />
            </>
          )}
        </Show>
      </WindowControls>
    </WindowToolbar>
  );
}, 'LibraryToolbar');
