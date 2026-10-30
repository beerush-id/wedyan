import { $bind, $static, mutable, Show, Snippet, setup } from '@airlib/react';
import { EmptyState, Select, TextInput, Toggle, ToggleGroup } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { MarkdownRenderer } from '@airlib/react-aui/markdown';
import { ConfirmButton } from '@/components/ConfirmButton.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import { DeleteIcon, EditIcon, MemoryIcon, MemosIcon, PreviewIcon } from './icons.js';
import { edit, factsOf, memoAt, PRIORITIES, type MemoPriority, priorityOf } from './library.js';
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
 * confirmed. Every change is made to the memo itself, so the list beside it sees it at once.
 */
export const MemoEditor = setup(() => {
  const session = memoCtx.get() as MemoSession;
  const memo = () => (session.path ? memoAt(session.path) : undefined);

  /**
   * Changes the open memo, while it's still on the drive, and marks when it changed.
   *
   * @param apply - What to change in it.
   */
  const change = (apply: (document: MemoDocument) => void) => {
    const document = memo();
    if (document) edit(document, () => apply(document));
  };

  // What the fields edit: the memo's own values, read live and written straight back to it. A
  // normal priority is the memo saying nothing about it.
  const fields = {
    get name() {
      return memo()?.name ?? '';
    },
    set name(name: string) {
      change((document) => (document.name = name));
    },
    get body() {
      return memo()?.body ?? '';
    },
    set body(body: string) {
      change((document) => (document.body = body));
    },
    get priority(): string {
      const document = memo();
      return document ? priorityOf(document) : 'normal';
    },
    set priority(priority: string) {
      change((document) => {
        if (priority === 'high' || priority === 'low') document.priority = priority;
        else delete document.priority;
      });
    },
  };

  // The words open drawn when there's something to read, and as their source when there's nothing yet.
  const view = mutable({ mode: $static(() => (memo()?.body ? 'preview' : 'edit')) });

  return () => (
    <WindowPanel surface="solid" role="region" aria-label="Memo" className={CLASS.PANEL}>
      <Show
        when={memo}
        fallback={() => (
          <EmptyState title="This memo is gone" description="It was deleted." level={3}>
            <EmptyState.Snippet for="icon">{() => <MemosIcon />}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {() => (
          <article className={CLASS.MEMO}>
            <header className={CLASS.HEAD}>
              <span className={CLASS.GLYPH} aria-hidden="true">
                <Snippet data={memo}>{(document) => (document?.author.kind === 'agent' ? <MemoryIcon /> : <MemosIcon />)}</Snippet>
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
              <Snippet data={memo}>{(document) => document && <p className={CLASS.FACTS}>{factsOf(document)}</p>}</Snippet>
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
