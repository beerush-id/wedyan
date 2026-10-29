import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, effect, mutable, onCleanup, Show, Snippet, setup } from '@airlib/react';
import {
  Button,
  DescriptionList,
  Divider,
  EmptyState,
  Gallery,
  type GalleryEntry,
  Select,
  Toggle,
  ToggleGroup,
} from '@airlib/react-aui';
import { defineWindow, Window, WindowBody, WindowContent, WindowControls, WindowTitle, WindowToolbar } from '@airlib/react-aui/desktop';
import { ArrowLeft } from '@airlib/react-aui/icons';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { DeleteIcon, DownloadIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { documentAt, drive } from '@/lib/documents/store.js';
import { focusPrompt } from '@/lib/systems/focus.js';
import manifest from '../manifest.json';
import { ChatView, MemoView, StillView } from './Documents.js';
import { ComposeView } from './Editor.js';
import { AddIcon, ComposeIcon, DirectIcon, FilterIcon, ProjectsIcon, RenderIcon, SortIcon } from './icons.js';
import { AssigneeAvatar, assigneeAt } from './assignment.js';
import { albumOf, albums, duration, length, type Project, projects, shortDate, stagesOf } from './library.js';
import { MotionsDockOptions, MotionsDockSubject } from './options.js';
import { ProjectView } from './Project.js';
import { goUp, isEditing, type MotionsData, type MotionsRoute, openAlbum, openIn } from './route.js';
import { endSession, type MotionsSession, sessionCtx, sessionOf } from './session.js';

const CLASS = {
  SHEET: 'wedyan-motions-sheet',
  RECENTS: 'wedyan-motions-recents',
  NEW: 'wedyan-motions-new',
  ALBUM: 'wedyan-motions-album',
  PREVIEW: 'wedyan-motions-preview',
  ALBUM_PAGE: 'wedyan-motions-album-page',
  SHELF: 'wedyan-motions-shelf',
};

/** How many of the newest projects the library's first row shows. */
const RECENTS = 8;

/** How many of an album's projects its row on the library shows, before showing all. */
const ALBUM_PREVIEW = 3;

/** How an album's projects can be ordered. */
const SORTS = { updated: 'Recently updated', name: 'Name' };

/** Which of an album's projects show, by where they stand. */
const STATUSES = { all: 'Any status', draft: 'Drafts', rendered: 'Rendered' };

/** Why an album narrowed to where its projects stand shows nothing. */
const NONE_SHOWN: Record<string, string> = {
  draft: 'No drafts in this album.',
  rendered: 'Nothing rendered in this album yet.',
};

/**
 * Motions: a library of projects, each a `.motion` — from the ask it started with to the video it
 * becomes. The library is one sheet: the newest projects in a row, after a way to start a new one,
 * then the albums they're kept in, each opening to its projects, ordered and narrowed as asked.
 * Each window keeps its own place: the library, an album, a project open, or one of the project's
 * documents open in its own view — a stage in the editor, a still, a chat, a memo. Back goes up a
 * level. Opened with a document's path, a window starts there. While Motions is in front, the dock
 * holds how new motions are made.
 */
export const motions = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: { width: 960, height: 620 },
  window: { snap: '.aui-window', minWidth: 560, minHeight: 400 },
  dockExtensions: MotionsDockOptions,
  dockSubject: MotionsDockSubject,
}).render((props) => {
  const data = props.instance.data as MotionsData;
  const route = mutable<MotionsRoute>({ view: 'library' });
  if (data?.path) openIn(route, data.path, data.motion);

  // What this window works on, shared with its dock, which can open documents here too.
  const id = props.instance.id;
  const session = sessionOf(id);
  session.open = (path) => openIn(route, path);
  session.route = route;
  sessionCtx.set(session);
  onCleanup(() => endSession(id));

  // `picked` is one project's path while picking one, and the checked paths while picking several.
  const pick = mutable({ picked: null as string | string[] | null, several: false });

  // How an album's projects are ordered and narrowed, kept as the window moves between albums.
  const shelf = mutable({ sort: 'updated', status: 'all' });

  const project = (): Project | undefined => {
    const document = route.motion ? documentAt<'motion'>(route.motion) : undefined;
    return document && route.motion ? { path: route.motion, document } : undefined;
  };
  const opened = () => (route.path ? documentAt(route.path) : undefined);
  const title = () => {
    if (route.view === 'library') return manifest.label;
    if (route.view === 'album') return albumOf(route.place)?.name ?? '';
    return opened()?.name ?? project()?.document.name ?? '';
  };

  // Each view starts at its top, rather than where the one before it was scrolled to, with nothing picked.
  let body: HTMLDivElement | null = null;
  effect(() => {
    void [route.view, route.place, route.motion, route.path];
    body?.closest('.aui-window-scroll')?.scrollTo({ top: 0 });
    Object.assign(pick, { picked: null, several: false });
  });
  const open = (path: string) => openIn(route, path);
  const recents = () => projects().slice(0, RECENTS);
  // The open album's projects, narrowed to where they stand, then ordered.
  const shelved = () => {
    const kept = (albumOf(route.place)?.projects() ?? []).filter((item) => shelf.status === 'all' || item.document.status === shelf.status);
    return shelf.sort === 'name' ? kept.sort((a, b) => a.document.name.localeCompare(b.document.name)) : kept;
  };

  /** The paths picked: the one project, or every checked one. */
  const pickedPaths = (): string[] => (Array.isArray(pick.picked) ? pick.picked : pick.picked ? [pick.picked] : []);

  // A double click opens the tile. While picking one, its second click unpicks the tile again, so the
  // tile is found by its place among the tiles and picked; while picking several, its two clicks cancel out.
  const openTile = (event: MouseEvent<HTMLElement>, shown: () => Project[]) => {
    const tile = (event.target as Element).closest('[role="option"]');
    if (!tile) return;
    const at = [...event.currentTarget.querySelectorAll('[role="option"]')].indexOf(tile);
    const item = shown()[at];
    if (!item) return;
    if (!pick.several) pick.picked = item.path;
    open(item.path);
  };

  // While picking one, Enter on the picked tile opens it, caught before the gallery would take it as unpicking.
  const openOnEnter = (event: KeyboardEvent<HTMLElement>) => {
    const tile = (event.target as Element).closest('[role="option"]');
    if (event.key !== 'Enter' || pick.several || tile?.getAttribute('aria-selected') !== 'true') return;
    event.preventDefault();
    event.stopPropagation();
    open(pick.picked as string);
  };

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
              { label: 'Open in Direct', icon: <DirectIcon />, run: () => Object.assign(route, { view: 'motion', motion: one, path: undefined, stage: undefined, item: undefined }) },
              { label: 'Open in Compose', icon: <ComposeIcon />, run: () => open(one) },
            ],
          ]),
      [
        { label: 'Share', icon: <ShareIcon /> },
        { label: 'Download', icon: <DownloadIcon /> },
      ],
      [{ label: 'Delete', icon: <DeleteIcon />, run: remove }],
    ];
  };

  // Projects to pick and open, as tiles wrapping into rows — or, for the newest, one row that scrolls along.
  const gallery = (label: string, shown: () => Project[], className: string) => (
    <div className={className} onDoubleClick={(event) => openTile(event, shown)} onKeyDownCapture={openOnEnter}>
      <Gallery
        label={label}
        items={$use(() => shown().map(toTile))}
        value={$bind(pick, 'picked')}
        multiple={$bind(pick, 'several')}
        checkable
        flow={className !== CLASS.RECENTS}
      />
    </div>
  );

  // Starting a motion is asking Wedyan for one, so it puts the caret in the prompt, the dock's tools for it beside.
  const newMotion = (
    <button type="button" className={CLASS.NEW} onClick={focusPrompt}>
      <AddIcon />
      <span>New motion</span>
    </button>
  );

  /** The library: the newest projects after a way to start one, then the albums, each opening to its projects. */
  const sheet = (): ReactNode =>
    projects().length ? (
      <div className={CLASS.SHEET}>
        <section aria-labelledby="wedyan-motions-recents">
          <h2 id="wedyan-motions-recents">Recents</h2>
          <div className={`${CLASS.RECENTS}-row`}>
            {newMotion}
            {gallery('Recent projects', recents, CLASS.RECENTS)}
          </div>
        </section>
        {albums().map((album, at) => {
          const count = album.projects().length;
          const heading = `wedyan-motions-album-${at}`;
          return (
            <section key={album.key} aria-labelledby={heading} className={CLASS.ALBUM}>
              <h2 id={heading}>
                <button type="button" onClick={() => openAlbum(route, album.key)}>
                  {album.name}
                </button>
              </h2>
              <div className={`${CLASS.ALBUM}-about`}>
                {album.cover && <img src={album.cover} alt="" />}
                <p>{album.description}</p>
              </div>
              <div className={`${CLASS.ALBUM}-projects`}>
                {count ? gallery(album.name, () => album.projects().slice(0, ALBUM_PREVIEW), CLASS.PREVIEW) : <p>Nothing kept here yet.</p>}
                {count > ALBUM_PREVIEW && (
                  <Button size="sm" variant="text" onClick={() => openAlbum(route, album.key)}>
                    {`Show all (${count})`}
                  </Button>
                )}
              </div>
            </section>
          );
        })}
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

  /**
   * An album: its picture, what it is and its facts, then its projects under a heading with how
   * they're ordered and narrowed beside it — or why there's none to show.
   */
  const shelfView = (): ReactNode => {
    const album = albumOf(route.place);
    if (!album) return null;
    const all = album.projects();
    const narrowed = shelf.status !== 'all';
    const updated = all.map((item) => item.document.updated).sort().at(-1);
    return (
      <div className={CLASS.ALBUM_PAGE}>
        <header className={`${CLASS.ALBUM_PAGE}-overview`}>
          {album.cover && <img src={album.cover} alt="" />}
          <div>
            <h2>{album.name}</h2>
            <p>{album.description}</p>
            <DescriptionList
              size="sm"
              items={[
                { label: 'Projects', value: String(all.length) },
                { label: 'Length', value: duration(all.reduce((total, item) => total + length(item), 0)) },
                ...(updated ? [{ label: 'Updated', value: shortDate(updated) }] : []),
              ]}
            />
          </div>
        </header>
        <section aria-labelledby="wedyan-motions-album-projects">
          <div className={`${CLASS.ALBUM_PAGE}-heading`}>
            <h3 id="wedyan-motions-album-projects">Projects</h3>
            <Select size="sm" variant="text" label="Sort by" options={SORTS} value={$bind(shelf, 'sort')}>
              <Select.Snippet for="trigger">
                {(value) => (
                  <>
                    <SortIcon /> <span>{SORTS[value as keyof typeof SORTS]}</span>
                  </>
                )}
              </Select.Snippet>
            </Select>
            <Select size="sm" variant="text" label="Show" options={STATUSES} value={$bind(shelf, 'status')}>
              <Select.Snippet for="trigger">
                {(value) => (
                  <>
                    <FilterIcon /> <span>{STATUSES[value as keyof typeof STATUSES]}</span>
                  </>
                )}
              </Select.Snippet>
            </Select>
          </div>
          {shelved().length ? (
            gallery(album.name, shelved, CLASS.SHELF)
          ) : (
            <EmptyState title="Nothing to show" description={narrowed ? NONE_SHOWN[shelf.status] : 'This album is empty.'}>
              <EmptyState.Snippet for="icon">{() => (narrowed ? <FilterIcon /> : <ProjectsIcon />)}</EmptyState.Snippet>
            </EmptyState>
          )}
        </section>
      </div>
    );
  };

  // The editor's two modes, as tabs: Direct, the project's writing, and Compose, a stage put together.
  const tabs = mutable({ mode: 'direct' });
  effect(() => {
    tabs.mode = route.view === 'stage' ? 'compose' : 'direct';
  });
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
    return route.view === 'album' ? shelfView() : sheet();
  };

  // Going up says where it goes: the library from an album, the album a project was opened from, or the project.
  const upLabel = () => {
    if (route.view === 'album') return 'Back to the library';
    if (isEditing(route)) return route.place ? 'Back to the album' : 'All projects';
    return 'Back to the project';
  };

  return () => (
    <Window>
      {/*
       * In the editor the toolbar rests on the window's glass and the views sit on it directly, as
       * panels of their own; elsewhere the content is the window's one panel, under the toolbar.
       */}
      <Window.Snippet for="body">
        {() => (
          <WindowBody className={isEditing(route) ? 'wedyan-editor' : undefined}>
            <WindowToolbar className={isEditing(route) ? 'wedyan-editor-toolbar' : undefined}>
              <Show when={() => route.view !== 'library'}>
                {() => (
                  <>
                    <Button
                      aria-label={upLabel()}
                      size="sm"
                      variant="text"
                      className={AUI_CLASS.CONTROL_ICON}
                      onClick={() => goUp(route)}
                    >
                      <ArrowLeft />
                    </Button>
                    <Divider orientation="vertical" variant="ghost" size="sm" />
                  </>
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
              <WindowTitle>
                <Snippet>{title}</Snippet>
              </WindowTitle>
              {/* While projects are picked, what can be done with them sits beside the title. */}
              <Show when={() => (route.view === 'library' || route.view === 'album') && pickedPaths().length > 0}>
                {() => (
                  <SelectionActions
                    label="Picked projects"
                    count={pick.several ? `${pickedPaths().length} selected` : undefined}
                    groups={selection()}
                  />
                )}
              </Show>
              <WindowControls>
                <Show when={() => route.view === 'stage'}>{() => <ComposeActions />}</Show>
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
 * A project as a gallery tile: its cover, captioned with its name, then how long it runs, where it
 * stands and who made it, and when it last changed.
 *
 * @param item - The project to show.
 * @returns The tile.
 */
function toTile(item: Project): GalleryEntry {
  const { document } = item;
  return {
    value: item.path,
    src: document.cover,
    alt: document.name,
    title: document.name,
    description: [duration(length(item)), document.status === 'rendered' ? 'Rendered' : 'Draft', document.author.kind === 'agent' ? 'Wedyan' : 'You'].join(' · '),
    meta: shortDate(document.updated),
  };
}

