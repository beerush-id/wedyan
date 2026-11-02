import { $bind, $static, $use, effect, mutable, Show, Snippet, setup } from '@airlib/react';
import { EmptyState, Select, Spinner, TextInput, Toggle, ToggleGroup } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { MarkdownRenderer } from '@airlib/react-aui/markdown';
import { ConfirmButton } from '@/components/ConfirmButton.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { DeleteIcon, EditIcon, MemoryIcon, MemosIcon, PreviewIcon } from './icons.js';
import { edit, factsOf, PRIORITIES, type MemoPriority, priorityOf } from './library.js';
import { memoCtx, type MemoSession } from './session.js';

const CLASS = {
  PANEL: 'wedyan-memo-open',
  MEMO: 'wedyan-memo-page',
  HEAD: 'wedyan-memo-head',
  GLYPH: 'wedyan-memo-glyph',
  NAME: 'wedyan-memo-name',
  META: 'wedyan-memo-meta',
  FIELD: 'wedyan-memo-field',
  FIELD_HEAD: 'wedyan-memo-field-head',
  FIELD_LABEL: 'wedyan-memo-field-label',
  SOURCE: 'wedyan-memo-source',
  EMPTY: 'wedyan-memo-empty',
  FOOT: 'wedyan-memo-foot',
  FACTS: 'wedyan-memo-facts',
};

/**
 * The open memo, edited in place: its name, how much it weighs, and its words in Markdown, drawn
 * or as their source as Motions shows a script; then who wrote it and when, and deleting it, once
 * confirmed. The memo is held, so every change saves as it's made, and the list beside it is told.
 */
export const MemoEditor = setup<{ path: string }>((props) => {
  const session = memoCtx.get() as MemoSession;
  // Made afresh for each memo, so which file it works on never changes under it.
  const path = $static(() => props.path);
  const file = dfs.binding<MemoDocument>(path);

  /**
   * Changes the open memo, while it's still on the drive, and marks when it changed.
   *
   * @param apply - What to change in it.
   */
  const change = (apply: (document: MemoDocument) => void) => {
    const document = file.data;
    if (!document) return;
    edit(document, () => apply(document));
    session.changed(path, document);
  };

  // What the fields edit: the memo's own values, read live and written straight back to it. A
  // normal priority is the memo saying nothing about it.
  const fields = {
    get name() {
      return file.data?.name ?? '';
    },
    set name(name: string) {
      change((document) => (document.name = name));
    },
    get body() {
      return file.data?.body ?? '';
    },
    set body(body: string) {
      change((document) => (document.body = body));
    },
    get priority(): string {
      const document = file.data;
      return document ? priorityOf(document) : 'normal';
    },
    set priority(priority: string) {
      change((document) => {
        if (priority === 'high' || priority === 'low') document.priority = priority;
        else delete document.priority;
      });
    },
  };

  const view = mutable({ mode: null as string | null });

  // The words open drawn when there's something to read, and as their source when there's nothing yet.
  effect(() => {
    const { data } = file;
    if (data && !view.mode) view.mode = data.body ? 'preview' : 'edit';
  });

  return () => (
    <WindowPanel surface="solid" role="region" aria-label="Memo" className={CLASS.PANEL}>
      <Show
        when={() => file.data}
        fallback={() => (
          <EmptyState
            title={$use(() => (file.ready ? 'This memo is gone' : 'Loading it'))}
            description={$use(() => (file.ready ? 'It was deleted.' : undefined))}
            level={3}
          >
            <EmptyState.Snippet for="icon">{() => (file.ready ? <MemosIcon /> : <Spinner label="Loading it" />)}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {() => (
          <article className={CLASS.MEMO}>
            <header className={CLASS.HEAD}>
              <span className={CLASS.GLYPH} aria-hidden="true">
                <Snippet data={() => file.data}>{(document) => (document?.author.kind === 'agent' ? <MemoryIcon /> : <MemosIcon />)}</Snippet>
              </span>
              <TextInput label="Name" placeholder="What it's about" value={$bind(fields, 'name')} className={CLASS.NAME} />
            </header>
            <div className={CLASS.META}>
              <div className={CLASS.FIELD}>
                <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                  Priority
                </span>
                <Select size="sm" label="Priority" options={PRIORITIES} value={$bind(fields, 'priority')}>
                  <Select.Snippet for="trigger">{(value) => PRIORITIES[value as MemoPriority]}</Select.Snippet>
                </Select>
              </div>
            </div>
            <div className={CLASS.FIELD}>
              <div className={CLASS.FIELD_HEAD}>
                <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                  Memo
                </span>
                <ToggleGroup aria-label="Show the memo" size="sm" value={$bind(view, 'mode')} required>
                  <Toggle value="preview" variant="text" size="sm">
                    <PreviewIcon />
                    <span>Preview</span>
                  </Toggle>
                  <Toggle value="edit" variant="text" size="sm">
                    <EditIcon />
                    <span>Edit</span>
                  </Toggle>
                </ToggleGroup>
              </div>
              <Snippet data={() => view.mode}>
                {(mode) =>
                  mode === 'edit' ? (
                    <TextInput
                      multiline
                      rows={12}
                      label="Memo, in Markdown"
                      placeholder="Write it down, in Markdown."
                      value={$bind(fields, 'body')}
                      className={CLASS.SOURCE}
                    />
                  ) : (
                    <Show when={() => fields.body} fallback={() => <p className={CLASS.EMPTY}>Nothing written yet.</p>}>
                      {(text) => <MarkdownRenderer text={text} />}
                    </Show>
                  )
                }
              </Snippet>
            </div>
            <footer className={CLASS.FOOT}>
              <Snippet data={() => file.data}>{(document) => document && <p className={CLASS.FACTS}>{factsOf(document)}</p>}</Snippet>
              <ConfirmButton
                size="sm"
                variant="tonal"
                title={() => `Delete ${fields.name || 'this memo'}?`}
                description="It's taken off your memos."
                action="Delete"
                onconfirm={() => session.remove()}
              >
                <DeleteIcon />
                <span>Delete memo</span>
              </ConfirmButton>
            </footer>
          </article>
        )}
      </Show>
    </WindowPanel>
  );
}, 'MemoEditor');
