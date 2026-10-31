import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, mutable, onCleanup, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, type GalleryValue, Toggle, Tooltip } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import { ArrowLeft } from '@airlib/react-aui/icons';
import type { ReactNode } from 'react';
import { deleteConfirm } from '@/components/confirm.js';
import { SidebarCloseIcon, SidebarOpenIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { WedyanGallery, type WedyanGalleryEntry, WedyanGallerySearch } from '@/components/WedyanGallery.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { DeleteIcon, FlaggedIcon, FlagIcon, InboxIcon, LabelIcon, MailIcon, ReadIcon, UnreadIcon } from './icons.js';
import {
  allRead,
  allTagged,
  FLAGGED,
  LABELS,
  type ListingRequest,
  library,
  listing,
  type Mail,
  mailById,
  markRead,
  matches,
  nameOfPerson,
  ROOT,
  toggleRead,
  toggleTag,
} from './library.js';
import { CONTEXTS } from './prompt.js';
import { MailReader, mailCtx } from './Reader.js';

/** What Mail's window can be opened with: the message to open first, by path; nothing open otherwise. */
export type MailData = { path?: string } | undefined;

/** The tags Mail lists down its side, by tag, with their names. */
const TAG_LABELS: Record<string, string> = {
  [FLAGGED]: 'Flagged',
  ...Object.fromEntries(LABELS.map((label) => [label.tag, label.label])),
};

const CLASS = {
  PAGE: 'wedyan-mail-page',
  LIST: 'wedyan-mail-list',
};

/** How each open Mail window opens a message in it, by the window's id, for `openMail`. */
const openers = new Map<string, (path: string) => void>();

/**
 * Mail: a reader of the inbox, where outside services write what arrives, worked through one
 * message at a time in one window. Down the side: the Inbox, Unread and Flagged, and each label,
 * which lists every message carrying it. Beside it, the messages there, newest first; and beside the
 * list, the picked message, read in place. Picking a message marks it read.
 */
export const mail = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 760, minHeight: 400 },
}).render((props) => {
  // `picked` is one path while picking one, and the checked paths while picking several. While a
  // tag or Unread is listed, `folder` is still the one it was opened from, to go back to.
  const view = mutable({
    place: { folder: ROOT } as ListingRequest,
    folder: ROOT,
    picked: ((props.instance.data as MailData)?.path ?? null) as string | string[] | null,
    several: false,
    query: '',
    sidebarHidden: false,
  });

  // Picking one message opens it beside the list and marks it read; while Unread is listed, it
  // stays there until going elsewhere, so reading it doesn't take it away.
  const pick = {
    get value(): GalleryValue {
      return view.picked;
    },
    set value(picked: GalleryValue) {
      view.picked = picked;
      if (typeof picked !== 'string') return;
      markRead(picked);
      const where = view.place;
      if ('unread' in where && !where.keep.includes(picked)) where.keep.push(picked);
    },
  };

  // The message picked is the one open beside the list, shared with its reader.
  const opened = () => (typeof view.picked === 'string' ? view.picked : null);
  mailCtx.set({
    get path() {
      return opened();
    },
  });

  const entries = (): Mail[] => listing(view.place).filter((message) => matches(message, view.query));
  const checked = () => (Array.isArray(view.picked) ? view.picked.length : 0);
  const atRoot = () => 'folder' in view.place && view.place.folder === ROOT;
  const title = () => {
    const where = view.place;
    if ('tag' in where) return TAG_LABELS[where.tag] ?? where.tag;
    if ('unread' in where) return 'Unread';
    return 'Inbox';
  };

  // Lets go of the pick: the mode first, while the value is still a list, then the value.
  const release = () => {
    view.several = false;
    view.picked = null;
  };

  /**
   * Lists the inbox, a tag's messages, or the unread ones in place of what's shown, with nothing
   * picked and nothing searched, as a new place starts.
   *
   * @param place - Where to go.
   */
  const go = (place: ListingRequest) => {
    release();
    view.place = place;
    if ('folder' in place) view.folder = place.folder;
    view.query = '';
  };

  // Opens a message asked for from outside the window: where it's listed now, else in the inbox.
  openers.set(props.instance.id, (path) => {
    if (!entries().some((message) => message.path === path)) go({ folder: ROOT });
    release();
    pick.value = path;
  });
  onCleanup(() => openers.delete(props.instance.id));

  /** The paths picked: the one, or every checked one. */
  const pickedPaths = (): string[] => (Array.isArray(view.picked) ? view.picked : view.picked ? [view.picked] : []);

  // Takes the picked messages out of the inbox for this session.
  const remove = () => {
    const paths = pickedPaths();
    release();
    library.deleted.push(...paths);
  };

  /** The actions for what's picked, in their groups: read; keep; remove. */
  const selection = (): SelectionAction[][] => {
    const paths = pickedPaths();
    const read = allRead(paths);
    const flagged = allTagged(paths, FLAGGED);
    return [
      [{ label: read ? 'Mark as unread' : 'Mark as read', icon: read ? <UnreadIcon /> : <ReadIcon />, run: () => toggleRead(paths) }],
      [{ label: flagged ? 'Unflag' : 'Flag', icon: flagged ? <FlaggedIcon /> : <FlagIcon />, run: () => toggleTag(paths, FLAGGED) }],
      [{ label: 'Delete', icon: <DeleteIcon />, run: remove, confirm: deleteConfirm(paths.length, 'mail', 'mails', 'your mailbox') }],
    ];
  };

  /** One place down the side: the Inbox, Unread, or a tag. */
  const destination = (label: string, icon: ReactNode, current: () => boolean, run: () => void) => (
    <Button key={label} variant="text" size="sm" aria-current={$use(() => (current() ? 'true' : undefined))} onClick={run}>
      {icon}
      <span>{label}</span>
    </Button>
  );

  // Beside the list while no message is open: what's checked, or how to open one.
  const nothingOpen = () => (
    <Show
      when={checked}
      fallback={() => (
        <EmptyState title="Nothing open" description="Pick a message to read it here." level={3}>
          <EmptyState.Snippet for="icon">{() => <MailIcon />}</EmptyState.Snippet>
        </EmptyState>
      )}
    >
      {(count) => (
        <EmptyState title={count === 1 ? '1 message checked' : `${count} messages checked`} description="Press Escape to pick one again." level={3}>
          <EmptyState.Snippet for="icon">{() => <MailIcon />}</EmptyState.Snippet>
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
            <Show when={() => !atRoot()}>
              {() => (
                <>
                  <Button
                    aria-label="Back to the inbox"
                    size="sm"
                    variant="text"
                    className={AUI_CLASS.CONTROL_ICON}
                    onClick={() => go({ folder: view.folder })}
                  >
                    <ArrowLeft />
                    <Tooltip>Back to the inbox</Tooltip>
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
            {/* While messages are picked, what can be done with them sits beside the title. */}
            <Show when={() => pickedPaths().length > 0}>
              {() => (
                <SelectionActions
                  label="Picked messages"
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
                {destination('Inbox', <InboxIcon />, atRoot, () => go({ folder: ROOT }))}
                {destination('Unread', <UnreadIcon />, () => 'unread' in view.place, () => go({ unread: true, keep: [] }))}
                {destination(TAG_LABELS[FLAGGED], <FlagIcon />, () => 'tag' in view.place && view.place.tag === FLAGGED, () => go({ tag: FLAGGED }))}
              </WindowSidebarPanel>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Labels</WindowSidebarLabel>
                {LABELS.map((label) =>
                  destination(label.label, <LabelIcon />, () => 'tag' in view.place && view.place.tag === label.tag, () => go({ tag: label.tag }))
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
            {/* Sets the search apart from the window's own buttons; Mail has no actions of its own while mail only arrives. */}
            <Divider orientation="vertical" variant="ghost" size="sm" />
          </>
        )}
      </Window.Snippet>
      <div className={CLASS.PAGE}>
        {/* The search is Mail's own, through subject, sender and body, so the gallery is handed what it found. */}
        <WedyanGallery
          label={$use(title)}
          entries={$use(() => entries().map(galleryEntryOf))}
          value={$bind(pick, 'value')}
          multiple={$bind(view, 'several')}
          layout="list"
          checkable
          className={CLASS.LIST}
        />
        {/* A message picked anew starts its reader afresh. */}
        <Snippet data={opened}>{(path) => (path ? <MailReader key={path} /> : nothingOpen())}</Snippet>
      </div>
    </Window>
  );
});

/**
 * Opens a message in Mail's window: brings the window forward, opening it when it isn't, and opens
 * the message beside the list, marked read. This is what `app.mail.open { id }` will call.
 *
 * @param id - The message's id: its file's name, e.g. `m1` for `/Mail/m1.eml`.
 * @returns Mail's window.
 * @throws When no message in the inbox has that id.
 */
export function openMail(id: string) {
  const message = mailById(id);
  if (!message) throw new Error(`No message "${id}" in the inbox.`);
  markRead(message.path);

  const showing = mail.instances[0];
  if (showing) {
    openers.get(showing.id)?.(message.path);
    showing.focus();
    return showing;
  }

  return mail.open({ path: message.path }, { name: 'browser', contexts: CONTEXTS });
}

/**
 * A message as the rows every Wedyan gallery shows: who sent it, its subject, when, and what it says.
 * Mail has no kind of its own in the gallery yet, so it shows as a document.
 *
 * @param message - The message.
 * @returns The file, for the gallery.
 */
function galleryEntryOf(message: Mail): WedyanGalleryEntry {
  return {
    path: message.path,
    name: message.subject,
    kind: 'document',
    detail: nameOfPerson(message.from),
    modified: new Date(message.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    summary: message.body.replace(/\s+/g, ' ').trim(),
    person: nameOfPerson(message.from),
  };
}
