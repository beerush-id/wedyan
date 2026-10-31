import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, effect, mutable, onCleanup, Show, Snippet, setup } from '@airlib/react';
import { Button, DescriptionList, Divider, EmptyState, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowBody,
  WindowContent,
  WindowControls,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
  WindowToolbar,
} from '@airlib/react-aui/desktop';
import { ArrowLeft, ClockIcon, FolderIcon } from '@airlib/react-aui/icons';
import type { ReactNode } from 'react';
import { PERSON_TABS, type PersonTab } from '@/apps/lounge/views/session.js';
import { deleteConfirm } from '@/components/confirm.js';
import { SaveButton } from '@/components/SaveButton.js';
import { AlbumIcon, DeleteIcon, DownloadIcon, FavoritesIcon, PreviewPanelIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import {
  BROWSE_CLASS,
  WedyanGallery,
  type WedyanGalleryEntry,
  type WedyanGalleryLayout,
  WedyanGalleryLayoutToggle,
  WedyanGallerySearch,
} from '@/components/WedyanGallery.js';
import { documentAt, drive, nameOf, parentOf } from '@/lib/documents/store.js';
import { focusPrompt } from '@/lib/systems/focus.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { ChatView, MemoView, StillView } from './Documents.js';
import { ComposeView } from './Editor.js';
import {
  AddIcon,
  ComposeIcon,
  DirectIcon,
  GenerativeIcon,
  ProjectsIcon,
  RenderIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
} from './icons.js';
import { AssigneeAvatar, assigneeAt } from './assignment.js';
import {
  ALBUMS,
  duration,
  type Entry,
  FAVORITE,
  GENERATIVE,
  length,
  type ListingRequest,
  listing,
  type Project,
  projects,
  ROOT,
  shortDate,
  stagesOf,
} from './library.js';
import { MotionsDockOptions, MotionsDockSubject } from './options.js';
import { ProjectView } from './Project.js';
import { CONTEXTS } from './prompt.js';
import { goUp, isEditing, type MotionsRoute, openIn } from './route.js';
import { endSession, type MotionsSession, sessionCtx, sessionOf } from './session.js';

/** The tags Motions lists down its side, with their names: Favorites, Generative, and each album. */
const TAG_LABELS: Record<string, string> = {
  [FAVORITE]: 'Favorites',
  [GENERATIVE]: 'Generative',
  ...Object.fromEntries(ALBUMS.map((album) => [album.tag, album.label])),
};

/**
 * Motions: a browser of the Motions folder, as Photos is of its own, where each project — a
 * `.motion`, from the ask it started with to the video it becomes — lists as one file. Down the
 * side: Motions itself, Recents, and the tags — Favorites, Generative, and each album. Beside the
 * tiles, a preview of the picked project. Opening a folder lists it here; opening a project opens it
 * in a window of its own, which keeps its place: the project in Direct or Compose, or one of its
 * documents in its own view — a still, a chat, a memo. Back goes up a level. While Motions is in
 * front, the dock holds how new motions are made.
 */
export const motions = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 560, minHeight: 400 },
  multiple: true,
  dockExtensions: MotionsDockOptions,
  dockSubject: MotionsDockSubject,
}).render((props) => {
  // A window opened on a project brings its own live route, which its title and picture follow; the library otherwise.
  const route = (props.instance.data as MotionsRoute | undefined) ?? mutable<MotionsRoute>({ view: 'library' });

  // What this window works on, shared with its dock, which can open documents here too.
  const id = props.instance.id;
  const session = sessionOf(id);
  session.open = (path) => openIn(route, path);
  session.route = route;
  sessionCtx.set(session);
  onCleanup(() => endSession(id));

  // `picked` is one project's path while picking one, and the checked paths while picking several.
  const pick = mutable({ picked: null as string | string[] | null, several: false });

  // What the library lists and how: a folder, a tag or the newest; while a tag or the newest is
  // listed, `folder` is still the one it was opened from, to go back to.
  const browse = mutable({
    place: { folder: ROOT } as ListingRequest,
    folder: ROOT,
    layout: 'grid' as WedyanGalleryLayout,
    query: '',
    sidebarHidden: false,
    previewShown: false,
  });

  const project = (): Project | undefined => {
    const document = route.motion ? documentAt<'motion'>(route.motion) : undefined;
    return document && route.motion ? { path: route.motion, document } : undefined;
  };
  const opened = () => (route.path ? documentAt(route.path) : undefined);
  const title = () => (route.view === 'library' ? browseTitle() : titleOf(route));

  // Each view starts at its top, rather than where the one before it was scrolled to, with nothing picked or searched.
  let body: HTMLDivElement | null = null;
  effect(() => {
    void [route.view, route.motion, route.path];
    body?.closest('.aui-window-scroll')?.scrollTo({ top: 0 });
    Object.assign(pick, { picked: null, several: false });
    browse.query = '';
  });
  const open = (path: string) => openIn(route, path);

  const entries = (): Entry[] => listing(browse.place);
  const picked = () => entries().find((entry) => entry.path === pick.picked);
  const checked = () => (Array.isArray(pick.picked) ? pick.picked.length : 0);
  const browseTitle = () => {
    const { place } = browse;
    if ('recent' in place) return 'Recents';
    if ('tag' in place) return TAG_LABELS[place.tag] ?? place.tag;
    return place.folder === ROOT ? manifest.label : nameOf(place.folder);
  };
  // Whether the library has somewhere to go back to: the folder a tag or the newest was opened from, or the folder above.
  const canGoBack = () => !('folder' in browse.place) || browse.place.folder !== ROOT;

  /**
   * Lists a folder, a tag or the newest in place of what's shown, with nothing picked and nothing
   * searched, as a new place starts.
   *
   * @param request - The folder, the tag, or the newest.
   */
  const go = (request: ListingRequest) => {
    Object.assign(pick, { several: false, picked: null });
    Object.assign(browse, { place: request, query: '' }, 'folder' in request ? { folder: request.folder } : {});
  };

  // Back from a tag or the newest to the folder it was opened from, or up from a folder to the one it's in.
  const back = () => go({ folder: 'folder' in browse.place ? parentOf(browse.folder) : browse.folder });

  /**
   * Opens what a tile is: a folder, here; a project, in a window of its own.
   *
   * @param entry - What the tile is.
   */
  const openEntry = (entry: Entry) => {
    if (entry.kind === 'folder') go({ folder: entry.path });
    else openMotions(entry.path);
  };

  /** The paths picked: the one project, or every checked one. */
  const pickedPaths = (): string[] => (Array.isArray(pick.picked) ? pick.picked : pick.picked ? [pick.picked] : []);

  // Takes the picked projects out for this session: the mode first, while the value is still a list.
  const remove = () => {
    const paths = pickedPaths();
    pick.several = false;
    pick.picked = null;
    drive.deleted.push(...paths);
  };

  /**
   * The actions for what's picked, in their groups: open, for one project, in Direct or Compose;
   * send; remove. Sending waits on the system's tools.
   */
  const selection = (): SelectionAction[][] => {
    const [one] = pickedPaths();
    return [
      ...(pick.several
        ? []
        : [
            [
              { label: 'Open in Direct', icon: <DirectIcon />, run: () => openMotions(one, true) },
              { label: 'Open in Compose', icon: <ComposeIcon />, run: () => openMotions(one) },
            ],
          ]),
      [
        { label: 'Share', icon: <ShareIcon /> },
        { label: 'Download', icon: <DownloadIcon /> },
      ],
      [{ label: 'Delete', icon: <DeleteIcon />, run: remove, confirm: deleteConfirm(pickedPaths().length, 'item', 'items', 'your drive') }],
    ];
  };

  /** The picked project or folder, beside the tiles: its picture, its facts, and what it was asked to be. */
  const preview = () => (
    <aside className={`${BROWSE_CLASS.PREVIEW} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Preview">
      <Show
        when={picked}
        fallback={() => (
          <Show
            when={checked}
            fallback={() => (
              <EmptyState title="Nothing picked" description="Pick a project to see it here." level={3}>
                <EmptyState.Snippet for="icon">{() => <ProjectsIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          >
            {(count) => (
              <EmptyState title={count === 1 ? '1 item checked' : `${count} items checked`} description="Press Escape to pick one again." level={3}>
                <EmptyState.Snippet for="icon">{() => <ProjectsIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          </Show>
        )}
      >
        {(entry) => {
          const facts = entryFacts(entry);
          return (
            <>
              <button type="button" className={BROWSE_CLASS.PREVIEW_OPEN} aria-label={`Open ${entry.name}`} onClick={() => openEntry(entry)}>
                {facts.picture ? <img src={facts.picture} alt="" /> : <FolderIcon />}
              </button>
              <h3 className={BROWSE_CLASS.PREVIEW_NAME}>{entry.name}</h3>
              <DescriptionList size="sm" items={facts.items} />
              {facts.ask && <DescriptionList size="sm" layout="stacked" items={[{ label: 'Asked', value: facts.ask }]} />}
            </>
          );
        }}
      </Show>
    </aside>
  );

  /** The library: what's listed as tiles or rows, the picked one's preview beside — or a way to start the first. */
  const sheet = (): ReactNode =>
    projects().length ? (
      <div className={BROWSE_CLASS.ROOT}>
        <WedyanGallery
          label={$use(browseTitle)}
          entries={$use(() => entries().map(galleryEntryOf))}
          value={$bind(pick, 'picked')}
          multiple={$bind(pick, 'several')}
          layout={$use(() => browse.layout)}
          query={$use(() => browse.query)}
          checkable
          className={BROWSE_CLASS.GALLERY}
          onopen={(file) => {
            const entry = entries().find((each) => each.path === file.path);
            if (entry) openEntry(entry);
          }}
        />
        <Show when={() => browse.previewShown}>{preview}</Show>
      </div>
    ) : (
      <EmptyState title="No motions yet" description="Ask Wedyan for one, and it starts here.">
        <EmptyState.Snippet for="icon">{() => <ProjectsIcon />}</EmptyState.Snippet>
        <EmptyState.Snippet for="action">
          {() => (
            <Button size="sm" variant="filled" onClick={focusPrompt}>
              <AddIcon />
              <span>New motion</span>
            </Button>
          )}
        </EmptyState.Snippet>
      </EmptyState>
    );

  // The editor's two modes, as tabs: Direct, the project's writing, and Compose, a stage put together.
  const tabs = mutable({ mode: 'direct' });
  effect(() => {
    tabs.mode = route.view === 'stage' ? 'compose' : 'direct';
  });
  // A cast open in Direct is edited as in Lounge, its tabs in the toolbar beside the editor's.
  const castOpen = () => route.view === 'motion' && !!route.item && documentAt(route.item)?.type === 'persona';
  const personTabs = {
    get value() {
      return route.person ?? 'profile';
    },
    set value(tab: string) {
      route.person = tab as PersonTab;
    },
  };

  const switchMode = (mode: string) => {
    const current = project();
    if (!current) return;
    if (mode === 'direct') Object.assign(route, { view: 'motion', path: undefined });
    else {
      const stage = route.stage ?? stagesOf(current)[0]?.path;
      if (stage) openIn(route, stage);
    }
  };

  /** What the window shows where it is: the library, the project, or a document in its own view. */
  const content = (): ReactNode => {
    const current = project();
    const document = opened();
    if (route.view === 'motion' && current) {
      return <ProjectView key={current.path} project={current} route={route} open={open} />;
    }
    if (route.view === 'stage' && current && document?.type === 'stage' && route.path) {
      return <ComposeView key={route.path} project={current} source={document} path={route.path} open={open} />;
    }
    if (route.view === 'still' && document?.type === 'still') return <StillView key={route.path} document={document} open={open} />;
    if (route.view === 'chat' && document?.type === 'chat') return <ChatView key={route.path} document={document} open={open} />;
    if (route.view === 'memo' && document?.type === 'memo') return <MemoView key={route.path} document={document} open={open} />;
    return sheet();
  };

  // Going back says where it goes: in the library, to the folder before; in a project, to the library; in a document, to its project.
  const upLabel = () => {
    if (route.view === 'library') return 'folder' in browse.place ? 'Up a folder' : 'Back to the folder';
    return isEditing(route) ? 'All projects' : 'Back to the project';
  };

  /** One place down the side: Motions itself, Recents, or a tag. */
  const place = (label: string, icon: ReactNode, current: () => boolean, request: ListingRequest) => (
    <Button key={label} variant="text" size="sm" aria-current={$use(() => (current() ? 'true' : undefined))} onClick={() => go(request)}>
      {icon}
      <span>{label}</span>
    </Button>
  );

  return () => (
    <Window>
      {/* The library's places down the side, as Photos has its own; a project in Direct or Compose has panels of its own instead. */}
      <Window.Snippet for="sidebar">
        {() =>
          route.view === 'library' &&
          !browse.sidebarHidden && (
            <WindowSidebar>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Library</WindowSidebarLabel>
                {place(manifest.label, <ProjectsIcon />, () => 'folder' in browse.place && browse.place.folder === ROOT, { folder: ROOT })}
                {place('Recents', <ClockIcon />, () => 'recent' in browse.place, { recent: true })}
                {place(TAG_LABELS[FAVORITE], <FavoritesIcon />, () => 'tag' in browse.place && browse.place.tag === FAVORITE, { tag: FAVORITE })}
                {place(TAG_LABELS[GENERATIVE], <GenerativeIcon />, () => 'tag' in browse.place && browse.place.tag === GENERATIVE, { tag: GENERATIVE })}
              </WindowSidebarPanel>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Albums</WindowSidebarLabel>
                {ALBUMS.map((album) =>
                  place(album.label, <AlbumIcon />, () => 'tag' in browse.place && browse.place.tag === album.tag, { tag: album.tag })
                )}
              </WindowSidebarPanel>
            </WindowSidebar>
          )
        }
      </Window.Snippet>
      {/*
       * In the editor the toolbar rests on the window's glass and the views sit on it directly, as
       * panels of their own; elsewhere the content is the window's one panel, under the toolbar.
       */}
      <Window.Snippet for="body">
        {() => (
          <WindowBody className={isEditing(route) ? 'wedyan-editor' : undefined}>
            <WindowToolbar className={isEditing(route) ? 'wedyan-editor-toolbar' : undefined}>
              <Show when={() => route.view !== 'library' || canGoBack()}>
                {() => (
                  <>
                    <Button
                      aria-label={upLabel()}
                      size="sm"
                      variant="text"
                      className={AUI_CLASS.CONTROL_ICON}
                      onClick={() => (route.view === 'library' ? back() : goUp(route))}
                    >
                      <ArrowLeft />
                    </Button>
                    <Show when={() => isEditing(route)}>
                      {() => (
                        <Toggle
                          aria-label="Sidebar"
                          size="sm"
                          variant="text"
                          className={AUI_CLASS.CONTROL_ICON}
                          pressed={$bind(session, 'sidebar')}
                        >
                          <Snippet>{() => (session.sidebar ? <SidebarCloseIcon /> : <SidebarOpenIcon />)}</Snippet>
                          <Tooltip>Sidebar</Tooltip>
                        </Toggle>
                      )}
                    </Show>
                    <Divider orientation="vertical" variant="ghost" size="sm" />
                  </>
                )}
              </Show>
              <Show when={() => route.view === 'library'}>
                {() => (
                  <Toggle
                    aria-label="Hide sidebar"
                    size="sm"
                    variant="text"
                    className={AUI_CLASS.CONTROL_ICON}
                    pressed={$bind(browse, 'sidebarHidden')}
                  >
                    <Snippet>{() => (browse.sidebarHidden ? <SidebarOpenIcon /> : <SidebarCloseIcon />)}</Snippet>
                    <Tooltip>Hide sidebar</Tooltip>
                  </Toggle>
                )}
              </Show>
              <Show when={() => isEditing(route)}>
                {() => (
                  <>
                    <ToggleGroup
                      aria-label="Editor"
                      size="sm"
                      variant="glass"
                      value={$bind(tabs, 'mode')}
                      required
                      onchange={(event) => switchMode(String(event.detail))}
                    >
                      <Toggle value="direct" variant="text" size="sm">
                        <DirectIcon />
                        <span>Direct</span>
                      </Toggle>
                      <Toggle value="compose" variant="text" size="sm">
                        <ComposeIcon />
                        <span>Compose</span>
                      </Toggle>
                    </ToggleGroup>
                    <Divider orientation="vertical" variant="ghost" size="sm" />
                  </>
                )}
              </Show>
              <Show when={castOpen}>
                {() => (
                  <>
                    <ToggleGroup aria-label="Show" size="sm" variant="glass" value={$bind(personTabs, 'value')} required>
                      {(Object.keys(PERSON_TABS) as PersonTab[]).map((tab) => (
                        <Toggle key={tab} value={tab} variant="text" size="sm">
                          <span>{PERSON_TABS[tab]}</span>
                        </Toggle>
                      ))}
                    </ToggleGroup>
                    <Divider orientation="vertical" variant="ghost" size="sm" />
                  </>
                )}
              </Show>
              <WindowTitle>
                <Snippet>{title}</Snippet>
              </WindowTitle>
              {/* While projects are picked, what can be done with them sits beside the title. */}
              <Show when={() => route.view === 'library' && pickedPaths().length > 0}>
                {() => (
                  <SelectionActions
                    label="Picked projects"
                    count={pick.several ? `${pickedPaths().length} selected` : undefined}
                    groups={selection()}
                  />
                )}
              </Show>
              <WindowControls>
                {/* A project open in Direct or Compose is being edited: saving it leads what can be done. */}
                <Show when={() => isEditing(route)}>{() => <SaveButton />}</Show>
                <Show when={() => route.view === 'stage'}>{() => <ComposeActions />}</Show>
                <Show when={() => route.view === 'library'}>
                  {() => (
                    <>
                      <WedyanGallerySearch query={$bind(browse, 'query')} />
                      <Divider orientation="vertical" variant="ghost" size="sm" />
                      {/* Starting a motion is asking Wedyan for one, so it puts the caret in the prompt, the dock's tools for it beside. */}
                      <Button aria-label="New motion" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={focusPrompt}>
                        <AddIcon />
                        <Tooltip>New motion</Tooltip>
                      </Button>
                      <Divider orientation="vertical" variant="ghost" size="sm" />
                      <WedyanGalleryLayoutToggle layout={$bind(browse, 'layout')} />
                      <Toggle
                        aria-label="Preview"
                        size="sm"
                        variant="text"
                        className={AUI_CLASS.CONTROL_ICON}
                        pressed={$bind(browse, 'previewShown')}
                      >
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
            <Snippet>
              {() =>
                isEditing(route) ? (
                  content()
                ) : (
                  <WindowContent>
                    <div
                      ref={(element) => {
                        body = element;
                      }}
                    >
                      {content()}
                    </div>
                  </WindowContent>
                )
              }
            </Snippet>
          </WindowBody>
        )}
      </Window.Snippet>
    </Window>
  );
});

/**
 * Opens a project in a Motions window of its own, so the window it was picked in keeps its place —
 * or brings forward the window already showing it.
 *
 * @param motion - The project's path.
 * @param direct - Whether it opens in Direct rather than Compose.
 * @returns The window showing the project.
 */
export function openMotions(motion: string, direct = false) {
  const showing = motions.instances.find((instance) => sessionOf(instance.id).route?.motion === motion);
  if (showing) {
    showing.focus();
    return showing;
  }

  const route = mutable<MotionsRoute>(direct ? { view: 'motion', motion } : { view: 'library' });
  if (!direct) openIn(route, motion);
  return motions.open(route, {
    name: 'project',
    contexts: CONTEXTS,
    get title() {
      return titleOf(route);
    },
    get thumbnail() {
      return route.motion ? documentAt<'motion'>(route.motion)?.cover : undefined;
    },
  });
}

/**
 * What can be done with the stage in Compose, in the toolbar: what its render says, who it's
 * assigned to, and Render, whose video downloads as it finishes — set apart from the window's own
 * controls.
 */
const ComposeActions = setup(() => {
  const session = sessionCtx.get() as MotionsSession;
  const assignee = () => session.stage && assigneeAt(session.stage, documentAt(session.stage)?.assignee);
  return () => (
    <>
      <Snippet>{() => (session.status ? <span className="wedyan-motions-notice">{session.status}</span> : null)}</Snippet>
      <Snippet data={assignee}>
        {(agent) =>
          agent ? (
            <>
              <AssigneeAvatar assignee={agent} />
              <Divider orientation="vertical" variant="ghost" size="sm" />
            </>
          ) : null
        }
      </Snippet>
      <Snippet>
        {() => (
          <Button size="sm" variant="filled" disabled={session.rendering} onClick={() => session.render?.()}>
            <RenderIcon />
            <span>Render</span>
          </Button>
        )}
      </Snippet>
      <Divider orientation="vertical" variant="ghost" size="sm" />
    </>
  );
}, 'ComposeActions');

/**
 * What a Motions window shows, as its title: the app in the library, or the open document, else its
 * project.
 *
 * @param route - The window's route.
 * @returns The title.
 */
function titleOf(route: MotionsRoute): string {
  if (route.view === 'library') return manifest.label;
  const opened = route.path ? documentAt(route.path) : undefined;
  const project = route.motion ? documentAt<'motion'>(route.motion) : undefined;
  return opened?.name ?? project?.name ?? '';
}

/**
 * What a listing holds, as the files every Wedyan gallery shows: a folder by how many projects it
 * holds; a project by its length, where it stands and who made it, and when it last changed.
 *
 * @param entry - What the listing holds.
 * @returns The file, for the gallery.
 */
function galleryEntryOf(entry: Entry): WedyanGalleryEntry {
  if (entry.kind === 'folder') {
    return { path: entry.path, name: entry.name, kind: 'folder', detail: entry.count === 1 ? '1 project' : `${entry.count} projects` };
  }
  const { project } = entry;
  const { document } = project;
  return {
    path: entry.path,
    name: entry.name,
    kind: 'motion',
    detail: [duration(length(project)), statusOf(project), document.author.kind === 'agent' ? 'Wedyan' : 'You'].join(' · '),
    modified: shortDate(document.updated),
  };
}

/**
 * What the preview says about what's picked: a project's cover, read from the project itself, its
 * facts, and what it was asked to be; a folder's count.
 *
 * @param entry - What's picked.
 * @returns Its picture, facts and ask.
 */
function entryFacts(entry: Entry): { picture?: string; items: { label: string; value: string }[]; ask?: string } {
  if (entry.kind === 'folder') return { items: [{ label: 'Holds', value: entry.count === 1 ? '1 project' : `${entry.count} projects` }] };
  const { project } = entry;
  const { document } = project;
  return {
    picture: document.cover,
    items: [
      { label: 'Length', value: duration(length(project)) },
      { label: 'Status', value: statusOf(project) },
      { label: 'Updated', value: shortDate(document.updated) },
    ],
    ask: document.author.kind === 'agent' ? document.author.ask : undefined,
  };
}

/**
 * Where a project stands, in a word.
 *
 * @param project - The project.
 * @returns `Rendered` or `Draft`.
 */
function statusOf(project: Project): string {
  return project.document.status === 'rendered' ? 'Rendered' : 'Draft';
}

