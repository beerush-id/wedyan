import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, derived, mutable, Snippet, setup, template } from '@airlib/react';
import { LIVE_SELECTION } from '@airlib/react/browser';
import {
  Button,
  DescriptionList,
  Divider,
  EmptyState,
  FloatingToolbar,
  Listbox,
  ListboxOption,
  TextInput,
  Toggle,
  ToggleGroup,
  Tooltip,
} from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { MarkdownRenderer } from '@airlib/react-aui/markdown';
import type { FC, ReactNode } from 'react';
import { documentAt, follow, keepWriting, resolvePath, sectionAt, writingAt } from '@/lib/documents/store.js';
import type {
  ChatDocument,
  MemoDocument,
  MotionAsset,
  MotionScript,
  PersonaDocument,
  StageDocument,
  StillDocument,
  TakeDocument,
} from '@/lib/documents/types.js';
import { runtime } from './composition.js';
import { ChatView, MemoView, StillView } from './Documents.js';
import { type Formatting, formatSelection } from './formatting.js';
import {
  BoldIcon,
  ChatIcon,
  ComposeIcon,
  EditIcon,
  ExpandIcon,
  HeadingIcon,
  ItalicIcon,
  ListIcon,
  MemoIcon,
  PreviewIcon,
  RewriteIcon,
  ScriptIcon,
  ShortenIcon,
  SoundIcon,
} from './icons.js';
import { castsOf, duration, length, posterOf, type Project, shortDate, stagesOf } from './library.js';
import type { MotionsRoute } from './route.js';
import { type MotionsSession, sessionCtx } from './session.js';

/** The key of the row Direct shows first: the project itself. */
const OVERVIEW = 'overview';

/** One row of Direct's list — a picture or an icon, a title, a line about it — and what it shows. */
type DirectItem = {
  key: string;
  title: string;
  description?: string;
  picture?: string;
  icon?: FC;
  /** What the content shows while the row is picked. */
  show: () => ReactNode;
};

/** A run of rows of one kind, under its name. */
type DirectGroup = { label: string; items: DirectItem[] };

type ProjectViewProps = {
  project: Project;
  /** The window's route, which keeps the picked row. */
  route: MotionsRoute;
  /** Opens a document, by path: a stage in Compose, anything else of the project picked here. */
  open: (path: string) => void;
};

/**
 * Direct: a project's writing and everything around it. Down the side, a list of what it holds —
 * the project itself, its stages, the assets they use, its casts, its chats and
 * memos — each a row with its picture, its title, and a line about it. Beside it, the picked row
 * shown in full. The pick follows the keyboard as it moves through the list, and the window keeps
 * it, so coming back to the project comes back to it.
 */
export const ProjectView = setup<ProjectViewProps>((props) => {
  const route = $static(() => props.route);
  // What the project holds is read once, as the project opens.
  const groups = $static(() => groupsOf(props.project, props.open));
  const items = groups.flatMap((group) => group.items);
  if (!$static(() => items.some((item) => item.key === route.item))) route.item = OVERVIEW;
  const picked = () => items.find((item) => item.key === route.item) ?? items[0];

  const session = sessionCtx.get() as MotionsSession;

  return () => (
    <div className="wedyan-direct">
      {/* What the project holds shows while the sidebar does; the layout follows which panels are there. */}
      <Snippet>
        {() =>
          session.sidebar && (
            <WindowPanel role="navigation" aria-label="Project" className="wedyan-direct-list">
              <Listbox
                label="What the project holds"
                value={$bind(route, 'item')}
                required
                oninput={(event) => {
                  route.item = event.detail;
                }}
              >
                {groups.map((group) =>
                  group.items.length ? (
                    <div key={group.label} role="group" aria-label={group.label} className="wedyan-direct-group">
                      <span className="wedyan-direct-group-label" aria-hidden="true">
                        {group.label}
                      </span>
                      {group.items.map((item) => (
                        <ListboxOption key={item.key} value={item.key} className="wedyan-direct-row">
                          <DirectRow item={item} />
                        </ListboxOption>
                      ))}
                    </div>
                  ) : null
                )}
              </Listbox>
            </WindowPanel>
          )
        }
      </Snippet>
      <WindowPanel surface="solid" role="region" aria-label="Picked" className="wedyan-direct-content">
        <Snippet>{() => picked().show()}</Snippet>
      </WindowPanel>
    </div>
  );
}, 'ProjectView');

/** A row's face: its picture, or its kind's icon on a tinted square, its title, and a line about it. */
const DirectRow = template<{ item: DirectItem }>((props) => {
  const { item } = props;
  const Icon = item.icon;
  return (
    <>
      {item.picture ? (
        <img className="wedyan-direct-thumb" src={item.picture} alt="" />
      ) : (
        <span className="wedyan-direct-thumb" aria-hidden="true">
          {Icon && <Icon />}
        </span>
      )}
      <span className="wedyan-direct-text" title={item.description ? `${item.title}\n${item.description}` : item.title}>
        <span className="wedyan-direct-title">{item.title}</span>
        {item.description && <span className="wedyan-direct-description">{item.description}</span>}
      </span>
    </>
  );
}, 'DirectRow');

/** The project itself: its whole script, beside its cover, what it is, and where it stands. */
const OverviewPane = template<{ project: Project }>((props) => {
  const { project } = props;
  const motion = project.document;
  return (
    <ScriptPane
      path={motion.script && resolvePath(project.path, motion.script.path)}
      from={project.path}
      script={motion.script}
      label="About the motion"
    >
      <ScriptPane.Snippet for="about">
        {() => (
          <ScriptAbout
            picture={motion.cover}
            ratio={motion.aspect.replace(':', ' / ')}
            title={motion.name}
            description={motion.description}
            facts={[
              { label: 'Length', value: motion.length ? `${duration(length(project))} of ${duration(motion.length)}` : duration(length(project)) },
              { label: 'Aspect', value: motion.aspect },
              { label: 'Stages', value: String(motion.stages.length) },
              { label: 'Status', value: motion.status === 'rendered' ? 'Rendered' : 'Draft' },
              { label: 'Made by', value: motion.author.kind === 'agent' ? 'Wedyan' : 'You' },
              ...(motion.author.kind === 'agent' && motion.author.ask ? [{ label: 'Asked', value: motion.author.ask }] : []),
              { label: 'Updated', value: shortDate(motion.updated) },
            ]}
          />
        )}
      </ScriptPane.Snippet>
      <ScriptPane.Snippet for="empty">
        {() => (
          <EmptyState title="No script yet" description="This motion has no script.">
            <EmptyState.Snippet for="icon">{() => <ScriptIcon />}</EmptyState.Snippet>
          </EmptyState>
        )}
      </ScriptPane.Snippet>
    </ScriptPane>
  );
}, 'OverviewPane');

/** A fact about what a script belongs to, as its aside lists it. */
type Fact = { label: string; value: string };

type ScriptPaneProps = {
  /** The script, from the drive's root: a file, or one section of it (`…/Script.md#heading`); none while there's none. */
  path?: string;
  /** The project's path, which its script's revisions are written from. */
  from: string;
  /** The project's script, whose revisions and history show beside this one when it's the same file. */
  script?: MotionScript;
  /** Names the aside, e.g. "About the stage". */
  label: string;
};

type ScriptPaneSlots = {
  /** What the script belongs to, under the aside's controls: its picture, its name, its facts. */
  about: () => ReactNode;
  /** What can be done with what it belongs to, across from the Preview and Edit toggle. */
  actions: () => ReactNode;
  /** What shows in the script's place while there's none. */
  empty: () => ReactNode;
};

/**
 * A script, with an aside: how it shows — as Markdown draws it, or, to edit, as its Markdown
 * source — across from what can be done with what it belongs to, then what that is, then, when
 * there's any, the versions kept before it, any of which can be picked to show instead, and what an agent was asked
 * about it, to read. A section shows the same section of each version. Only the version as it is
 * now can be edited; picking an older one goes back to the preview. What's edited is kept for this
 * session, a section in its place in its file. Selecting words brings up what can be done with them:
 * previewed, what an agent can do; edited, how they can be formatted.
 */
const ScriptPane = setup<ScriptPaneProps, ScriptPaneSlots>((props, slots) => {
  const path = $static(() => props.path);
  const from = $static(() => props.from);
  const script = $static(() => props.script);
  const [file, heading] = (path ?? '').split('#');
  // Versions and asks belong to the project's script file, so only a script in that file has them,
  // read as they stand.
  const own = () => !!script && resolvePath(from, script.path) === file;
  const revisions = () => (own() && script?.revisions) || [];
  const histories = () => (own() && script?.histories) || [];
  // The version shown — the script now, or one kept before it, by revision id — how, and the
  // script now as it's being edited.
  const view = mutable({ shown: CURRENT, mode: PREVIEW, draft: (path && writingAt(path)) ?? '' });
  const textOf = (id: string) => {
    if (id === CURRENT) return view.draft || 'Nothing written yet.';
    const revision = revisions().find((each) => each.id === id);
    const at = revision && resolvePath(from, revision.path);
    return (at && writingAt(heading ? `${at}#${heading}` : at)) ?? 'Not in this revision.';
  };
  const keep = () => path && keepWriting(path, view.draft);
  const switchMode = (mode: string) => {
    if (mode === EDIT) view.shown = CURRENT;
    else keep();
  };
  // The words selected are in the editor, while it shows.
  const format = (formatting: Formatting) => {
    const field = LIVE_SELECTION.target;
    if (field instanceof HTMLTextAreaElement) formatSelection(field, formatting);
  };
  const pick = (id: string) => {
    if (view.mode === EDIT) {
      keep();
      view.mode = PREVIEW;
    }
    view.shown = id;
  };
  const version = (id: string, title: string, meta: string) => (
    <li key={id}>
      <button type="button" aria-pressed={view.shown === id} onClick={() => pick(id)}>
        <span className="wedyan-script-title">{title}</span>
        <span className="wedyan-script-meta">{meta}</span>
      </button>
    </li>
  );

  return () => (
    <article className="wedyan-direct-pane wedyan-direct-script">
      {path ? body() : <div className="wedyan-script-body">{slots.empty?.()}</div>}
      <aside className="wedyan-script-aside" aria-label={props.label}>
        {(path || slots.actions) && (
          <div className="wedyan-script-controls">
            {path && (
              <ToggleGroup
                aria-label="Show the script"
                size="sm"
                value={$bind(view, 'mode')}
                required
                onchange={(event) => switchMode(String(event.detail))}
              >
                <Toggle value={PREVIEW} variant="text" size="sm">
                  <PreviewIcon />
                  <span>Preview</span>
                </Toggle>
                <Toggle value={EDIT} variant="text" size="sm">
                  <EditIcon />
                  <span>Edit</span>
                </Toggle>
              </ToggleGroup>
            )}
            {slots.actions && <div className="wedyan-script-actions">{slots.actions()}</div>}
          </div>
        )}
        {slots.about?.()}
        {slots.about && (revisions().length > 0 || histories().length > 0) && <Divider />}
        {revisions().length > 0 && (
          <section aria-labelledby="wedyan-script-revisions">
            <h3 id="wedyan-script-revisions">Revisions</h3>
            <ul>
              {version(CURRENT, 'Current', 'As it is now')}
              {revisions().map((revision, at, all) =>
                version(
                  revision.id,
                  revision.note ?? `Revision ${all.length - at}`,
                  `${shortDate(revision.created)} · ${revision.author.kind === 'agent' ? 'Wedyan' : 'You'}`
                )
              )}
            </ul>
          </section>
        )}
        {histories().length > 0 && (
          <section aria-labelledby="wedyan-script-histories">
            <h3 id="wedyan-script-histories">History</h3>
            <ol>
              {histories().map((history) => (
                <li key={history.id} className="wedyan-script-entry">
                  <span className="wedyan-script-title">{history.ask}</span>
                  <span className="wedyan-script-meta">
                    {[history.model && capitalize(history.model), history.effort && `${history.effort} effort`, shortDate(history.created)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>
    </article>
  );

  // The script, as Markdown draws it or as its source, with what can be done with the words selected in it.
  function body() {
    return (
      <div className="wedyan-script-body" data-floating-scope>
        {view.mode === EDIT ? (
          <TextInput
            multiline
            label="Script, in Markdown"
            value={$bind(view, 'draft')}
            className="wedyan-script-editor"
          />
        ) : (
          <MarkdownRenderer text={textOf(view.shown)} />
        )}
        {view.mode === EDIT ? (
          <FloatingToolbar label="Formatting">
            {FORMATTINGS.map(({ formatting, label, Icon }) => (
              <Button
                key={formatting}
                aria-label={label}
                size="sm"
                variant="text"
                className={AUI_CLASS.CONTROL_ICON}
                onClick={() => format(formatting)}
              >
                <Icon />
              </Button>
            ))}
          </FloatingToolbar>
        ) : (
          // What can be done with the words selected: placeholders until the writing tools land.
          <FloatingToolbar label="With the selection">
            <Button size="sm" variant="text">
              <RewriteIcon />
              <span>Rewrite</span>
            </Button>
            <Button size="sm" variant="text">
              <ShortenIcon />
              <span>Shorten</span>
            </Button>
            <Button size="sm" variant="text">
              <ExpandIcon />
              <span>Expand</span>
            </Button>
          </FloatingToolbar>
        )}
      </div>
    );
  }
}, 'ScriptPane');

/** The version a script pane shows first: the script as it is now. */
const CURRENT = 'current';

/** How a script pane shows the script: as Markdown draws it, or as its source, to edit. */
const PREVIEW = 'preview';
const EDIT = 'edit';

/** What the editor's selection can be formatted as, in the order its toolbar offers them. */
const FORMATTINGS: { formatting: Formatting; label: string; Icon: FC }[] = [
  { formatting: 'bold', label: 'Bold', Icon: BoldIcon },
  { formatting: 'italic', label: 'Italic', Icon: ItalicIcon },
  { formatting: 'heading', label: 'Heading', Icon: HeadingIcon },
  { formatting: 'list', label: 'List', Icon: ListIcon },
];

type StagePaneProps = {
  project: Project;
  path: string;
  stage: StageDocument;
  open: (path: string) => void;
};

/**
 * A stage: its part of the script, beside its picture, what it is, who's in it, and a way into
 * Compose. A stage without a part says so, and, when the project has a script, offers to write
 * one: a section under the stage's name at the end of the project's script, which the stage then
 * points to.
 */
const StagePane = setup<StagePaneProps>((props) => {
  const project = $static(() => props.project);
  const path = $static(() => props.path);
  const stage = $static(() => props.stage);
  const open = $static(() => props.open);
  const { width, height } = stage.composition.props;
  // The stage's casts by name, following its casts and the documents they name: one deleted drops out.
  const casts = derived(() =>
    (stage.casts ?? []).map((cast) => follow<'persona'>(path, cast).document?.name).filter(Boolean)
  );
  const scriptFile = project.document.script && resolvePath(project.path, project.document.script.path);
  const view = mutable({ script: stage.script && resolvePath(path, stage.script) });
  const write = () => {
    if (!scriptFile) return;
    const at = sectionAt(scriptFile, stage.name);
    if (writingAt(at) === undefined) keepWriting(at, `## ${stage.name}`);
    stage.script = at;
    view.script = at;
  };

  return () => (
    <ScriptPane key={view.script} path={view.script} from={project.path} script={project.document.script} label="About the stage">
      <ScriptPane.Snippet for="about">
        {() => (
          <ScriptAbout
            picture={posterOf(stage) ?? project.document.cover}
            ratio={`${width} / ${height}`}
            title={stage.name}
            description={stage.description}
            facts={[
              { label: 'Length', value: duration(runtime(stage.composition)) },
              { label: 'Size', value: `${width} × ${height}` },
              ...(casts.value.length ? [{ label: 'Casts', value: casts.value.join(', ') }] : []),
              { label: 'Updated', value: shortDate(stage.updated) },
            ]}
          />
        )}
      </ScriptPane.Snippet>
      <ScriptPane.Snippet for="actions">
        {() => (
          <Button aria-label="Open in Compose" size="sm" variant="filled" className={AUI_CLASS.CONTROL_ICON} onClick={() => open(path)}>
            <ComposeIcon />
            <Tooltip>Open in Compose</Tooltip>
          </Button>
        )}
      </ScriptPane.Snippet>
      <ScriptPane.Snippet for="empty">
        {() => (
          <EmptyState title="No script yet" description="This stage has no part of the script.">
            <EmptyState.Snippet for="icon">{() => <ScriptIcon />}</EmptyState.Snippet>
            {scriptFile && (
              <EmptyState.Snippet for="action">
                {() => (
                  <Button size="sm" variant="filled" onClick={write}>
                    Write its part
                  </Button>
                )}
              </EmptyState.Snippet>
            )}
          </EmptyState>
        )}
      </ScriptPane.Snippet>
    </ScriptPane>
  );
}, 'StagePane');

/** What a script belongs to, in its aside: its picture in its shape, its name, a line about it, and its facts. */
const ScriptAbout = template<{ picture?: string; ratio: string; title: string; description?: string; facts: Fact[] }>((props) => (
  <header className="wedyan-script-about">
    {props.picture && <img className="wedyan-direct-hero" style={{ aspectRatio: props.ratio }} src={props.picture} alt="" />}
    <div className="wedyan-direct-heading">
      <h2>{props.title}</h2>
      {props.description && <p>{props.description}</p>}
    </div>
    <DescriptionList size="sm" items={props.facts} />
  </header>
), 'ScriptAbout');

/** An asset: a generated image as its own document, otherwise the media itself, as it plays or shows. */
const AssetPane = template<{ asset: MotionAsset; from: string; open: (path: string) => void }>((props) => {
  const { asset, from, open } = props;
  if (asset.kind === 'still') {
    const { document } = follow<'still'>(from, asset.src);
    if (document) return <StillView document={document as StillDocument} open={open} />;
  }
  if (asset.kind === 'take') {
    const take = follow<'take'>(from, asset.src).document as TakeDocument | undefined;
    const chosen = take?.attempts.find((attempt) => attempt.id === take.chosen);
    if (take && chosen) {
      return (
        <article className="wedyan-direct-pane">
          <video className="wedyan-direct-hero" src={chosen.src} poster={chosen.poster} controls />
          <header className="wedyan-direct-heading">
            <h2>{take.name}</h2>
            <p>{chosen.prompt ?? take.prompt}</p>
          </header>
        </article>
      );
    }
  }

  const src = asset.src.includes('://') ? asset.src : resolvePath(from, asset.src);
  return (
    <article className="wedyan-direct-pane">
      {asset.kind === 'image' && <img className="wedyan-direct-hero" src={src} alt="" />}
      {asset.kind === 'video' && <video className="wedyan-direct-hero" src={src} controls />}
      {asset.kind === 'audio' && <audio src={src} controls />}
      <header className="wedyan-direct-heading">
        <h2>{asset.name}</h2>
      </header>
      <DescriptionList
        size="sm"
        items={[
          { label: 'Kind', value: ASSET_KINDS[asset.kind] },
          { label: 'From', value: asset.src },
        ]}
      />
    </article>
  );
}, 'AssetPane');

/** A cast: their portrait, who they are, their other looks, and their voice. */
const CastPane = template<{ persona: PersonaDocument }>((props) => {
  const { persona } = props;
  const [portrait, ...looks] = persona.looks;
  return (
    <article className="wedyan-direct-pane">
      <div className="wedyan-direct-person">
        {portrait && <img className="wedyan-direct-portrait" src={portrait} alt="" />}
        <header className="wedyan-direct-heading">
          <h2>{persona.name}</h2>
          {persona.description && <p>{persona.description}</p>}
        </header>
      </div>
      <DescriptionList
        size="sm"
        items={[
          { label: 'Kind', value: capitalize(persona.kind) },
          ...(persona.voice ? [{ label: 'Voice', value: persona.voice.name }] : []),
          { label: 'Updated', value: shortDate(persona.updated) },
        ]}
      />
      {looks.length > 0 && (
        <ul className="wedyan-direct-looks" aria-label="Other looks">
          {looks.map((look) => (
            <li key={look}>
              <img src={look} alt="" />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}, 'CastPane');

const ASSET_KINDS: Record<MotionAsset['kind'], string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  still: 'Generated image',
  take: 'Generated video',
};

/**
 * What Direct lists for a project, in its groups: the project, with its script, its stages, the
 * assets they use, its casts, its chats, and its memos. A generated asset, a cast, a chat and a memo
 * are keyed by their path, so opening one by path picks its row.
 *
 * @param project - The project.
 * @param open - Opens a document by path.
 * @returns Its groups, an empty one where it holds nothing of that kind.
 */
function groupsOf(project: Project, open: (path: string) => void): DirectGroup[] {
  const motion = project.document;
  const notes = (paths?: string[]) => (paths ?? []).map((path) => follow(project.path, path)).filter((note) => note.document);

  return [
    {
      label: 'Project',
      items: [
        {
          key: OVERVIEW,
          // The window's title already names the project; its row says what it shows.
          title: 'Overview',
          description: motion.description,
          picture: motion.cover,
          show: () => <OverviewPane project={project} />,
        },
      ],
    },
    {
      label: 'Stages',
      items: stagesOf(project).map(({ path, document }) => ({
        key: path,
        title: document.name,
        description: document.description ?? duration(runtime(document.composition)),
        picture: posterOf(document) ?? motion.cover,
        // Keyed by its stage, so picking another stage starts its pane afresh.
        show: () => <StagePane key={path} project={project} path={path} stage={document} open={open} />,
      })),
    },
    {
      label: 'Assets',
      items: motion.assets.map((asset) => {
        const generated = asset.kind === 'still' || asset.kind === 'take';
        return {
          key: generated ? follow(project.path, asset.src).path : `asset:${asset.id}`,
          title: asset.name,
          description: ASSET_KINDS[asset.kind],
          picture: pictureOf(project.path, asset),
          icon: SoundIcon,
          show: () => <AssetPane asset={asset} from={project.path} open={open} />,
        };
      }),
    },
    {
      label: 'Casts',
      items: castsOf(project).map(({ path, document }) => ({
        key: path,
        title: document.name,
        description: document.description ?? capitalize(document.kind),
        picture: document.looks[0],
        show: () => <CastPane persona={document} />,
      })),
    },
    {
      label: 'Chats',
      items: notes(motion.chats).map(({ path, document }) => {
        const chat = document as ChatDocument;
        const last = chat.messages.at(-1)?.parts.find((part) => part.kind === 'text');
        return {
          key: path,
          title: chat.name,
          description: last?.kind === 'text' ? last.text : undefined,
          icon: ChatIcon,
          show: () => <ChatView document={chat} open={open} />,
        };
      }),
    },
    {
      label: 'Memos',
      items: notes(motion.memos).map(({ path, document }) => {
        const memo = document as MemoDocument;
        return {
          key: path,
          title: memo.name,
          description: capitalize(memo.kind),
          icon: MemoIcon,
          show: () => <MemoView document={memo} open={open} />,
        };
      }),
    },
  ];
}

/**
 * An asset's picture: an image itself, or a generated one's chosen attempt; none for sound.
 *
 * @param from - The project's path, which the asset's own path is written from.
 * @param asset - The asset.
 * @returns Its picture's address, if it has one.
 */
function pictureOf(from: string, asset: MotionAsset): string | undefined {
  if (asset.kind === 'image') return asset.src;
  if (asset.kind === 'still') {
    const still = documentAt<'still'>(follow(from, asset.src).path) as StillDocument | undefined;
    return still?.attempts.find((attempt) => attempt.id === still.chosen)?.src;
  }
  if (asset.kind === 'take') {
    const take = documentAt<'take'>(follow(from, asset.src).path) as TakeDocument | undefined;
    return take?.attempts.find((attempt) => attempt.id === take.chosen)?.poster;
  }
}

/**
 * A word with its first letter capitalized, as a kind reads in a row.
 *
 * @param word - E.g. `character`.
 * @returns E.g. `Character`.
 */
function capitalize(word: string): string {
  return `${word[0].toUpperCase()}${word.slice(1)}`;
}
