import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, createContext, Show, Snippet, setup } from '@airlib/react';
import { Button, DatePicker, EmptyState, Select, Switch, TagInput, TextInput, Tooltip } from '@airlib/react-aui';
import { MarkdownRenderer } from '@airlib/react-aui/markdown';
import { shortId } from '@airlib/react/utils';
import { documentAt } from '@/lib/documents/store.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import { CloseIcon, MemosIcon } from './icons.js';
import { authorOf, edit, KINDS, longDate, setPinned, tagLabel, tags } from './library.js';

/** How the open memo's words show: as Markdown to change, or as they read. */
export type MemoMode = 'write' | 'read';

/** The memo open beside the list, and how its words show: what Memo's window shares with its editor. */
export type MemoSession = {
  /** The open memo's path; none while nothing, a folder, or several are picked. */
  readonly path: string | null;
  mode: MemoMode;
};

/** The memo open in a Memo window, which its editor works on. */
export const memoCtx = createContext<MemoSession>();

/** The time a reminder picked by its date alone is set for, in UTC. */
const REMIND_TIME = '09:00:00Z';

const CLASS = {
  EDITOR: 'wedyan-memo-editor',
  NAME: 'wedyan-memo-editor-name',
  META: 'wedyan-memo-editor-meta',
  FIELD: 'wedyan-memo-editor-field',
  FIELD_LABEL: 'wedyan-memo-editor-field-label',
  REMIND: 'wedyan-memo-editor-remind',
  PIN: 'wedyan-memo-editor-pin',
  BODY: 'wedyan-memo-editor-body',
  WRITE: 'wedyan-memo-editor-write',
  READ: 'wedyan-memo-editor-read',
  FACTS: 'wedyan-memo-editor-facts',
};

/**
 * The open memo, edited where it's listed: its name, what it is — kind, tags, reminder, pin — its
 * words, written in Markdown or shown as they read, and who wrote it. Every change is made to the
 * memo itself, so the list beside it sees it at once.
 */
export const MemoEditor = setup(() => {
  const session = memoCtx.get() as MemoSession;
  const memo = () => (session.path ? documentAt<'memo'>(session.path) : undefined);
  // Names the pin's switch by the words beside it, as the switch carries none of its own.
  const pinLabel = `wedyan-memo-pin-${shortId()}`;

  /**
   * Changes the open memo, while it's still on the drive, and marks when it changed.
   *
   * @param apply - What to change in it.
   */
  const change = (apply: (document: MemoDocument) => void) => {
    const document = memo();
    if (document) edit(document, () => apply(document));
  };

  // What the fields edit: the memo's own values, read live and written straight back to it.
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
    get kind() {
      return memo()?.kind ?? 'note';
    },
    set kind(kind: string) {
      if (kind in KINDS) change((document) => (document.kind = kind as MemoDocument['kind']));
    },
    get tags() {
      return memo()?.tags ?? [];
    },
    set tags(chosen: string[]) {
      change((document) => (document.tags = chosen));
    },
    get pinned() {
      return !!memo()?.pinned;
    },
    set pinned(pinned: boolean) {
      change((document) => setPinned(document, pinned));
    },
    // The picker holds a date; the memo keeps its reminder's time when one is set, the morning otherwise.
    get remind() {
      return memo()?.remind?.slice(0, 10) ?? '';
    },
    set remind(date: string) {
      change((document) => {
        if (!date) return void delete document.remind;
        document.remind = `${date}T${document.remind?.slice(11) || REMIND_TIME}`;
      });
    },
  };

  // Every tag the memos carry, and this memo's own, to choose from.
  const tagOptions = (): Record<string, string> =>
    Object.fromEntries([...new Set([...tags(), ...fields.tags])].map((tag) => [tag, tagLabel(tag)]));

  return () => (
    <Show
      when={memo}
      fallback={() => (
        <EmptyState title="This memo is gone" description="It was deleted from Memos." level={3}>
          <EmptyState.Snippet for="icon">{() => <MemosIcon />}</EmptyState.Snippet>
        </EmptyState>
      )}
    >
      {() => (
        <article className={`${CLASS.EDITOR} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Memo">
          <TextInput label="Name" placeholder="Name" value={$bind(fields, 'name')} className={CLASS.NAME} />
          <div className={CLASS.META}>
            <div className={CLASS.FIELD}>
              <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                Kind
              </span>
              {/* The trigger shows the kind alone; "Kind" stays only as its name. */}
              <Select size="sm" label="Kind" options={KINDS} value={$bind(fields, 'kind')}>
                <Select.Snippet for="trigger">{(kind) => KINDS[kind as MemoDocument['kind']]}</Select.Snippet>
              </Select>
            </div>
            <div className={CLASS.FIELD}>
              <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                Remind on
              </span>
              <div className={CLASS.REMIND}>
                <DatePicker size="sm" label="Remind on" placeholder="No reminder" value={$bind(fields, 'remind')} labels={DATE_LABELS} />
                <Show when={() => fields.remind}>
                  {() => (
                    <Button
                      aria-label="Clear reminder"
                      size="sm"
                      variant="text"
                      className={AUI_CLASS.CONTROL_ICON}
                      onClick={() => (fields.remind = '')}
                    >
                      <CloseIcon />
                      <Tooltip>Clear reminder</Tooltip>
                    </Button>
                  )}
                </Show>
              </div>
            </div>
            <div className={CLASS.FIELD}>
              <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                Tags
              </span>
              <TagInput
                size="sm"
                label="Tags"
                placeholder="Add a tag"
                options={$use(tagOptions)}
                value={$bind(fields, 'tags')}
                removeLabel={(text) => `Remove ${text}`}
              />
            </div>
            <div className={CLASS.PIN}>
              <span id={pinLabel}>Pinned</span>
              <Switch aria-labelledby={pinLabel} checked={$bind(fields, 'pinned')} />
            </div>
          </div>
          <section className={CLASS.BODY} aria-label="Words">
            <Show
              when={() => session.mode === 'write'}
              fallback={() => (
                <Show
                  when={() => fields.body.trim()}
                  fallback={() => (
                    <EmptyState title="Nothing written yet" description="Switch to Write to put down what to remember." level={3}>
                      <EmptyState.Snippet for="icon">{() => <MemosIcon />}</EmptyState.Snippet>
                    </EmptyState>
                  )}
                >
                  {() => (
                    <div className={CLASS.READ}>
                      <MarkdownRenderer text={$use(() => fields.body)} />
                    </div>
                  )}
                </Show>
              )}
            >
              {() => (
                <TextInput
                  multiline
                  label="Words"
                  placeholder="Write what to remember, in Markdown."
                  value={$bind(fields, 'body')}
                  className={CLASS.WRITE}
                />
              )}
            </Show>
          </section>
          <Snippet data={memo}>{(document) => document && <p className={CLASS.FACTS}>{factsOf(document)}</p>}</Snippet>
        </article>
      )}
    </Show>
  );
}, 'MemoEditor');

/** What the reminder's date picker says. */
const DATE_LABELS = {
  open: 'Pick a date',
  previous: 'Previous month',
  next: 'Next month',
  year: 'Year',
};

/**
 * Who wrote a memo and when, in a line: an agent's with the ask it came from.
 *
 * @param document - The memo.
 * @returns E.g. `By Wedyan, asked "Keep it calm" · Created … · Updated …`.
 */
function factsOf(document: MemoDocument): string {
  const ask = document.author.kind === 'agent' && document.author.ask ? `, asked “${document.author.ask}”` : '';
  return `By ${authorOf(document)}${ask} · Created ${longDate(document.created)} · Updated ${longDate(document.updated)}`;
}
