import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, For, mutable, Show, setup } from '@airlib/react';
import { LIVE_SELECTION } from '@airlib/react/browser';
import { Button, Divider, FloatingToolbar, TextInput, Toggle, ToggleGroup } from '@airlib/react-aui';
import { MarkdownRenderer } from '@airlib/react-aui/markdown';
import type { FC, ReactNode } from 'react';
import type { MotionScript } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { BoldIcon, EditIcon, ExpandIcon, HeadingIcon, ItalicIcon, ListIcon, PreviewIcon, RewriteIcon, ShortenIcon } from '../../icons.js';
import { shortDate } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { type Formatting, formatSelection } from '../formatting.js';

/** The version a script pane shows first: the script as it is now. */
const CURRENT = 'current';

/** What the editor's selection can be formatted as, in the order its toolbar offers them. */
const FORMATTINGS: { formatting: Formatting; label: string; Icon: FC }[] = [
  { formatting: 'bold', label: 'Bold', Icon: BoldIcon },
  { formatting: 'italic', label: 'Italic', Icon: ItalicIcon },
  { formatting: 'heading', label: 'Heading', Icon: HeadingIcon },
  { formatting: 'list', label: 'List', Icon: ListIcon },
];

type ScriptPaneProps = {
  /** The script's file; none while there's none. */
  path?: string;
  /** Its versions and asks, when it keeps them. */
  script?: MotionScript;
  /** Names the aside, e.g. "About the stage". */
  label: string;
};

type ScriptPaneSlots = {
  /** What the script belongs to, under the aside's controls. */
  about: () => ReactNode;
  /** What can be done with what it belongs to, across from the Preview and Edit toggle. */
  actions: () => ReactNode;
  /** What shows in the script's place while there's none. */
  empty: () => ReactNode;
};

/**
 * A script, with an aside: how it shows — as Markdown draws it, or, to edit, as its source — then
 * what it belongs to, the versions kept before it, any of which can be picked to show instead, and
 * what an agent was asked about it. The editor is bound to the file itself, so writing is saved as
 * it's written, and an agent's writing shows as it lands. Only the script as it is now can be
 * edited. Selecting words brings up what can be done with them.
 */
export const ScriptPane = setup<ScriptPaneProps, ScriptPaneSlots>((props, slots) => {
  const composer = composerCtx.get() as Composer;
  const view = mutable({ shown: CURRENT });

  const file = () => dfs.read<string>(props.path as string, 'text') as { data: string | undefined };
  const source = {
    get text() {
      return file().data ?? '';
    },
    set text(text: string) {
      file().data = text;
    },
  };
  const revisions = () => props.script?.revisions ?? [];
  const histories = () => props.script?.histories ?? [];

  const textOf = (id: string) => {
    if (id === CURRENT) return source.text || 'Nothing written yet.';
    const revision = revisions().find((each) => each.id === id);
    const at = revision && composer.pathOf(revision.path);
    return (at && dfs.read<string>(at, 'text').data) ?? 'Not in this revision.';
  };
  const pick = (id: string) => {
    composer.viewMode = 'preview';
    view.shown = id;
  };
  // The words selected are in the editor, while it shows.
  const format = (formatting: Formatting) => {
    const field = LIVE_SELECTION.target;
    if (field instanceof HTMLTextAreaElement) formatSelection(field, formatting);
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
      <Show when={() => props.path} fallback={() => <div className="wedyan-script-body">{slots.empty?.()}</div>}>
        {() => (
          <div className="wedyan-script-body" data-floating-scope>
            <Show
              when={() => composer.viewMode === 'edit'}
              fallback={() => (
                <>
                  <MarkdownRenderer text={textOf(view.shown)} />
                  {/* What can be done with the words selected: placeholders until the writing tools land. */}
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
                </>
              )}
            >
              {() => (
                <>
                  <TextInput multiline label="Script, in Markdown" value={$bind(source, 'text')} className="wedyan-script-editor" />
                  <FloatingToolbar label="Formatting">
                    {FORMATTINGS.map(({ formatting, label, Icon }) => (
                      <Button key={formatting} aria-label={label} size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => format(formatting)}>
                        <Icon />
                      </Button>
                    ))}
                  </FloatingToolbar>
                </>
              )}
            </Show>
          </div>
        )}
      </Show>
      <aside className="wedyan-direct-aside wedyan-script-aside" aria-label={props.label}>
        <div className="wedyan-script-controls">
          <Show when={() => props.path}>
            {() => (
              <ToggleGroup
                aria-label="Show the script"
                size="sm"
                value={$bind(composer, 'viewMode')}
                required
                onchange={() => {
                  view.shown = CURRENT;
                }}
              >
                <Toggle value="preview" variant="text" size="sm">
                  <PreviewIcon />
                  <span>Preview</span>
                </Toggle>
                <Toggle value="edit" variant="text" size="sm">
                  <EditIcon />
                  <span>Edit</span>
                </Toggle>
              </ToggleGroup>
            )}
          </Show>
          {slots.actions && <div className="wedyan-script-actions">{slots.actions()}</div>}
        </div>
        {slots.about?.()}
        <Show when={() => revisions().length > 0 || histories().length > 0}>{() => <Divider />}</Show>
        <Show when={() => revisions().length > 0}>
          {() => (
            <section aria-labelledby="wedyan-script-revisions">
              <h3 id="wedyan-script-revisions">Revisions</h3>
              <ul>
                {version(CURRENT, 'Current', 'As it is now')}
                {revisions().map((revision, at, all) =>
                  version(
                    revision.id,
                    revision.note ?? `Revision ${all.length - at}`,
                    `${shortDate(revision.created)} · ${revision.author.kind === 'agent' ? 'Wedyan' : 'You'}`,
                  ),
                )}
              </ul>
            </section>
          )}
        </Show>
        <Show when={() => histories().length > 0}>
          {() => (
            <section aria-labelledby="wedyan-script-histories">
              <h3 id="wedyan-script-histories">History</h3>
              <ol>
                <For each={histories}>
                  {(history) => (
                    <li className="wedyan-script-entry">
                      <span className="wedyan-script-title">{history.ask}</span>
                      <span className="wedyan-script-meta">
                        {[history.model, history.effort && `${history.effort} effort`, shortDate(history.created)].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  )}
                </For>
              </ol>
            </section>
          )}
        </Show>
      </aside>
    </article>
  );
}, 'ScriptPane');
