import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, effect, mutable, onCleanup, Show, Snippet, setup } from '@airlib/react';
import { Button, Divider, Gallery, type GalleryEntry, Toggle, ToggleGroup } from '@airlib/react-aui';
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
import { ArrowLeft } from '@airlib/react-aui/icons';
import type { FC, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { DeleteIcon, DownloadIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { documentAt, drive } from '@/lib/documents/store.js';
import manifest from '../manifest.json';
import { ChatView, MemoView, StillView } from './Documents.js';
import { ComposeView } from './Editor.js';
import { ComposeIcon, DirectIcon, GenerativeIcon, ProjectsIcon, RenderIcon } from './icons.js';
import { duration, length, type Project, projects, shortDate, stagesOf } from './library.js';
import { MotionsDockOptions } from './options.js';
import { ProjectView } from './Project.js';
import { goUp, isEditing, type MotionsData, type MotionsRoute, openIn } from './route.js';
import { endSession, type MotionsSession, sessionCtx, sessionOf } from './session.js';

/** A set of projects down the side, as they are now. */
type Collection = { name: string; label: string; icon: FC; projects: () => Project[] };

/** The library's collections, in the order people reach for them. */
const COLLECTIONS: Collection[] = [
  { name: 'all', label: 'Projects', icon: ProjectsIcon, projects },
  {
    name: 'generative',
    label: 'Generative',
    icon: GenerativeIcon,
    projects: () => projects().filter((item) => item.document.author.kind === 'agent'),
  },
];

const CLASS = {
  GALLERY: 'wedyan-motions-gallery',
};

/**
 * Motions: a library of projects, each a `.motion` — from the ask it started with to the video it
 * becomes. Each window keeps its own place: the library, a project open, or one of the project's
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
}).render((props) => {
  const data = props.instance.data as MotionsData;
  const route = mutable<MotionsRoute>({ view: 'library', place: 'all' });
  if (data?.path) openIn(route, data.path, data.motion);

  // What this window works on, shared with its dock, which can open documents here too.
  const id = props.instance.id;
  const session = sessionOf(id);
  session.open = (path) => openIn(route, path);
  sessionCtx.set(session);
  onCleanup(() => endSession(id));

  // `picked` is one project's path while picking one, and the checked paths while picking several.
  const pick = mutable({ picked: null as string | string[] | null, several: false });

  const collection = () => COLLECTIONS.find((item) => item.name === route.place) ?? COLLECTIONS[0];
  const project = (): Project | undefined => {
    const document = route.motion ? documentAt<'motion'>(route.motion) : undefined;
    return document && route.motion ? { path: route.motion, document } : undefined;
  };
  const opened = () => (route.path ? documentAt(route.path) : undefined);
  const title = () => (route.view === 'library' ? collection().label : (opened()?.name ?? project()?.document.name ?? ''));

  // Each view starts at its top, rather than where the one before it was scrolled to.
  let body: HTMLDivElement | null = null;
  effect(() => {
    void [route.view, route.motion, route.path];
    body?.closest('.aui-window-scroll')?.scrollTo({ top: 0 });
  });
  const tiles = () => collection().projects().map(toTile);
  const open = (path: string) => openIn(route, path);

  /** The paths picked: the one project, or every checked one. */
  const pickedPaths = (): string[] => (Array.isArray(pick.picked) ? pick.picked : pick.picked ? [pick.picked] : []);

  // A double click opens the tile. While picking one, its second click unpicks the tile again, so the
  // tile is found by its place among the tiles and picked; while picking several, its two clicks cancel out.
  const openTile = (event: MouseEvent<HTMLElement>) => {
    const tile = (event.target as Element).closest('[role="option"]');
    if (!tile) return;
    const at = [...event.currentTarget.querySelectorAll('[role="option"]')].indexOf(tile);
    const item = collection().projects()[at];
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

  /** The actions for what's picked, in their groups: send; remove. Sending waits on the system's tools. */
  const selection = (): SelectionAction[][] => [
    [
      { label: 'Share', icon: <ShareIcon /> },
      { label: 'Download', icon: <DownloadIcon /> },
    ],
    [{ label: 'Delete', icon: <DeleteIcon />, run: remove }],
  ];

  const place = (item: Collection) => {
    const Icon = item.icon;
    return (
      <Button
        key={item.name}
        variant="text"
        size="sm"
        aria-current={$use(() => (route.view === 'library' && route.place === item.name ? 'true' : undefined))}
        onClick={() => {
          Object.assign(route, { view: 'library', place: item.name, motion: undefined, path: undefined });
          Object.assign(pick, { picked: null, several: false });
        }}
      >
        <Icon />
        <span>{item.label}</span>
      </Button>
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
      return (
        <div className="wedyan-direct aui-glass-surface">
          <ProjectView key={current.path} project={current} open={open} />
        </div>
      );
    }
    if (route.view === 'stage' && current && document?.type === 'stage' && route.path) {
      return <ComposeView key={route.path} project={current} source={document} path={route.path} open={open} />;
    }
    if (route.view === 'still' && document?.type === 'still') return <StillView key={route.path} document={document} open={open} />;
    if (route.view === 'chat' && document?.type === 'chat') return <ChatView key={route.path} document={document} open={open} />;
    if (route.view === 'memo' && document?.type === 'memo') return <MemoView key={route.path} document={document} open={open} />;
    return (
      <div className={CLASS.GALLERY} onDoubleClick={openTile} onKeyDownCapture={openOnEnter}>
        <Gallery
          label={$use(() => collection().label)}
          items={$use(tiles)}
          value={$bind(pick, 'picked')}
          multiple={$bind(pick, 'several')}
          checkable
        />
      </div>
    );
  };

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="sidebar">
        {() =>
          isEditing(route) ? null : (
            <WindowSidebar>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Library</WindowSidebarLabel>
                {COLLECTIONS.map(place)}
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
              <Show when={() => route.view !== 'library'}>
                {() => (
                  <>
                    <Button
                      aria-label={isEditing(route) ? 'All projects' : 'Back to the project'}
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
 * What can be done with the stage in Compose, in the toolbar: what its render says, the last render
 * to save again, and Render — set apart from the window's own controls.
 */
const ComposeActions = setup(() => {
  const session = sessionCtx.get() as MotionsSession;
  return () => (
    <>
      <Snippet>{() => (session.status ? <span className="wedyan-motions-notice">{session.status}</span> : null)}</Snippet>
      <Snippet>
        {() =>
          session.download && !session.rendering ? (
            <Button size="sm" variant="text" onClick={() => session.download?.()}>
              <DownloadIcon />
              <span>Download</span>
            </Button>
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
 * A project as a gallery tile: its cover, captioned with its name, length, and date.
 *
 * @param item - The project to show.
 * @returns The tile.
 */
function toTile(item: Project): GalleryEntry {
  return {
    value: item.path,
    src: item.document.cover,
    alt: item.document.name,
    title: item.document.name,
    description: duration(length(item)),
    meta: shortDate(item.document.updated),
  };
}

