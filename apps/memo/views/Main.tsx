import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, mutable, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import { AddIcon, ArrowLeft } from '@airlib/react-aui/icons';
import type { ReactNode } from 'react';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { WedyanGallery, type WedyanGalleryEntry, WedyanGallerySearch } from '@/components/WedyanGallery.js';
import { drive, nameOf, parentOf, supply } from '@/lib/documents/store.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import {
  AlbumIcon,
  DeleteIcon,
  MemosIcon,
  PinIcon,
  PinnedIcon,
  ReadIcon,
  RemindersIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
  WriteIcon,
} from './icons.js';
import {
  allPinned,
  type Entry,
  freeMemoPath,
  KINDS,
  type ListingRequest,
  listing,
  ROOT,
  shortDate,
  tagLabel,
  tags,
  togglePinned,
} from './library.js';
import { MemoEditor, type MemoMode, memoCtx } from './Memo.js';

const CLASS = {
  PAGE: 'wedyan-memo-page',
  LIST: 'wedyan-memo-list',
};

/**
 * Memo: the memories Wedyan kept and the user can read and change, worked through one at a time in
 * one window. Down the side: Memos itself, the pinned memos, those with a reminder, and each tag the
 * memos carry. Beside it, the list of the open folder's folders and memos, or the view's memos; and
 * beside the list, the picked memo, edited in place — its name, kind, tags, pin, reminder and words.
 * Opening a folder lists it here; a new memo opens beside the list as it's made.
 */
export const memo = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 640, minHeight: 400 },
}).render(() => {
  // `picked` is one path while picking one, and the checked paths while picking several. While a
  // view other than a folder is listed, `folder` is still the one it was opened from, to go back to.
  const view = mutable({
    place: { folder: ROOT } as ListingRequest,
    folder: ROOT,
    picked: null as string | string[] | null,
    several: false,
    mode: 'write' as MemoMode,
    query: '',
    sidebarHidden: false,
  });

  // The memo picked is the one open beside the list, shared with its editor.
  const opened = () => (typeof view.picked === 'string' && view.picked.endsWith('.memo') ? view.picked : null);
  memoCtx.set({
    get path() {
      return opened();
    },
    get mode() {
      return view.mode;
    },
    set mode(mode: MemoMode) {
      view.mode = mode;
    },
  });

  const entries = (): Entry[] => listing(view.place);
  const checked = () => (Array.isArray(view.picked) ? view.picked.length : 0);
  const inFolder = () => 'folder' in view.place;
  const title = () => {
    const { place } = view;
    if ('pinned' in place) return 'Pinned';
    if ('reminders' in place) return 'Reminders';
    if ('tag' in place) return tagLabel(place.tag);
    return place.folder === ROOT ? manifest.label : nameOf(place.folder);
  };

  // Lets go of the pick: the mode first, while the value is still a list, then the value.
  const release = () => {
    view.several = false;
    view.picked = null;
  };

  /**
   * Lists a folder, or a view of the memos, in place of what's shown, with nothing picked and nothing
   * searched, as a new place starts.
   *
   * @param request - The folder, the tag, the pinned or the reminders.
   */
  const go = (request: ListingRequest) => {
    release();
    view.place = request;
    if ('folder' in request) view.folder = request.folder;
    view.query = '';
  };

  // Back from a view to the folder it was opened from, or up from a folder to the one it's in.
  const back = () => go({ folder: inFolder() ? parentOf(view.folder) : view.folder });

  // Starts a memo in the open folder — from a view, the folder it was opened from — carrying the
  // view's tag or pin, so it lists where it was started; then opens it beside the list, to write.
  const newMemo = () => {
    const { place } = view;
    const path = freeMemoPath(view.folder);
    const now = new Date().toISOString();
    const draft: MemoDocument = {
      type: 'memo',
      version: 1,
      id: crypto.randomUUID(),
      name: nameOf(path).replace(/\.memo$/, ''),
      created: now,
      updated: now,
      author: { kind: 'user' },
      tags: 'tag' in place ? [place.tag] : [],
      kind: 'note',
      body: '',
    };
    if ('pinned' in place) draft.pinned = true;
    supply([[path, draft]]);
    // Reminders lists only memos with one, so a new memo is shown in its folder instead.
    if ('reminders' in place) go({ folder: view.folder });
    release();
    view.query = '';
    view.picked = path;
    view.mode = 'write';
  };

  /** The memos picked: the one, or every checked one, leaving folders out. */
  const pickedPaths = (): string[] =>
    (Array.isArray(view.picked) ? view.picked : view.picked ? [view.picked] : []).filter((path) => path.endsWith('.memo'));

  // Takes the picked memos off the drive for this session.
  const remove = () => {
    const paths = pickedPaths();
    release();
    drive.deleted.push(...paths);
  };

  /** The actions for what's picked, in their groups: keep; remove. */
  const selection = (): SelectionAction[][] => {
    const paths = pickedPaths();
    const pinned = allPinned(paths);
    return [
      [{ label: pinned ? 'Unpin' : 'Pin', icon: pinned ? <PinnedIcon /> : <PinIcon />, run: () => togglePinned(paths) }],
      [{ label: 'Delete', icon: <DeleteIcon />, run: remove }],
    ];
  };

  /** One place down the side: Memos itself, a view, or a tag. */
  const place = (label: string, icon: ReactNode, current: () => boolean, run: () => void) => (
    <Button key={label} variant="text" size="sm" aria-current={$use(() => (current() ? 'true' : undefined))} onClick={run}>
      {icon}
      <span>{label}</span>
    </Button>
  );

  // Beside the list while no memo is open: what's checked, or how to open one.
  const nothingOpen = () => (
    <Show
      when={checked}
      fallback={() => (
        <EmptyState title="Nothing open" description="Pick a memo to work on it here." level={3}>
          <EmptyState.Snippet for="icon">{() => <MemosIcon />}</EmptyState.Snippet>
        </EmptyState>
      )}
    >
      {(count) => (
        <EmptyState title={count === 1 ? '1 item checked' : `${count} items checked`} description="Press Escape to pick one again." level={3}>
          <EmptyState.Snippet for="icon">{() => <MemosIcon />}</EmptyState.Snippet>
        </EmptyState>
      )}
    </Show>
  );

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">
        {() => (
          <>
            {/* Going back leads, set apart from the view it leaves: its sidebar and where it is. */}
            <Show when={() => !inFolder() || view.folder !== ROOT}>
              {() => (
                <>
                  <Button
                    aria-label={inFolder() ? 'Up a folder' : 'Back to the folder'}
                    size="sm"
                    variant="text"
                    className={AUI_CLASS.CONTROL_ICON}
                    onClick={back}
                  >
                    <ArrowLeft />
                    <Tooltip>{inFolder() ? 'Up a folder' : 'Back to the folder'}</Tooltip>
                  </Button>
                  <Divider orientation="vertical" variant="ghost" size="sm" />
                </>
              )}
            </Show>
            <Toggle aria-label="Hide sidebar" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(view, 'sidebarHidden')}>
              <Snippet>{() => (view.sidebarHidden ? <SidebarOpenIcon /> : <SidebarCloseIcon />)}</Snippet>
              <Tooltip>Hide sidebar</Tooltip>
            </Toggle>
            <WindowTitle>
              <Snippet>{title}</Snippet>
            </WindowTitle>
            {/* While memos are picked, what can be done with them sits beside the title. */}
            <Show when={() => pickedPaths().length > 0}>
              {() => (
                <SelectionActions
                  label="Picked memos"
                  count={view.several ? `${pickedPaths().length} selected` : undefined}
                  groups={selection()}
                />
              )}
            </Show>
          </>
        )}
      </Window.Snippet>
      <Window.Snippet for="sidebar">
        {() =>
          !view.sidebarHidden && (
            <WindowSidebar>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Library</WindowSidebarLabel>
                {place(manifest.label, <MemosIcon />, () => inFolder() && view.folder === ROOT, () => go({ folder: ROOT }))}
                {place('Pinned', <PinIcon />, () => 'pinned' in view.place, () => go({ pinned: true }))}
                {place('Reminders', <RemindersIcon />, () => 'reminders' in view.place, () => go({ reminders: true }))}
              </WindowSidebarPanel>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Albums</WindowSidebarLabel>
                {tags().map((tag) =>
                  place(tagLabel(tag), <AlbumIcon />, () => 'tag' in view.place && view.place.tag === tag, () => go({ tag }))
                )}
              </WindowSidebarPanel>
            </WindowSidebar>
          )
        }
      </Window.Snippet>
      <Window.Snippet for="actions">
        {() => (
          <>
            <WedyanGallerySearch query={$bind(view, 'query')} />
            <Divider orientation="vertical" variant="ghost" size="sm" />
            <Button aria-label="New memo" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={newMemo}>
              <AddIcon />
              <Tooltip>New memo</Tooltip>
            </Button>
            {/* How the open memo's words show, apart from making one. */}
            <Show when={opened}>
              {() => (
                <>
                  <Divider orientation="vertical" variant="ghost" size="sm" />
                  <ToggleGroup aria-label="Show the memo" value={$bind(view, 'mode')} required size="xs">
                    <Toggle value="write" aria-label="Write" size="xs" className={AUI_CLASS.CONTROL_ICON}>
                      <WriteIcon />
                      <Tooltip>Write</Tooltip>
                    </Toggle>
                    <Toggle value="read" aria-label="Read" size="xs" className={AUI_CLASS.CONTROL_ICON}>
                      <ReadIcon />
                      <Tooltip>Read</Tooltip>
                    </Toggle>
                  </ToggleGroup>
                </>
              )}
            </Show>
            {/* Sets the app's own buttons apart from the window's. */}
            <Divider orientation="vertical" variant="ghost" size="sm" />
          </>
        )}
      </Window.Snippet>
      <div className={CLASS.PAGE}>
        <WedyanGallery
          label={$use(title)}
          entries={$use(() => entries().map(galleryEntryOf))}
          value={$bind(view, 'picked')}
          multiple={$bind(view, 'several')}
          layout="list"
          query={$use(() => view.query)}
          checkable
          className={CLASS.LIST}
          onopen={(file) => {
            if (file.kind === 'folder') go({ folder: file.path });
          }}
        />
        {/* A memo picked anew starts its editor afresh, so its fields hold that memo from the start. */}
        <Snippet data={opened}>{(path) => (path ? <MemoEditor key={path} /> : nothingOpen())}</Snippet>
      </div>
    </Window>
  );
});

/**
 * What a listing holds, as the rows every Wedyan gallery shows: a folder by how much it holds, a
 * memo by its kind, whether it's pinned, and when it changed.
 *
 * @param entry - What the listing holds.
 * @returns The file, for the gallery.
 */
function galleryEntryOf(entry: Entry): WedyanGalleryEntry {
  if (entry.kind === 'folder') return { path: entry.path, name: entry.name, kind: 'folder', detail: countOf(entry.count) };
  const { document } = entry.memo;
  return {
    path: entry.path,
    name: entry.name,
    kind: 'document',
    detail: document.pinned ? `${KINDS[document.kind]} · Pinned` : KINDS[document.kind],
    modified: shortDate(document.updated),
  };
}

/**
 * How much a folder holds, in words.
 *
 * @param count - How many memos.
 * @returns E.g. `1 memo` or `3 memos`.
 */
function countOf(count: number): string {
  return count === 1 ? '1 memo' : `${count} memos`;
}
