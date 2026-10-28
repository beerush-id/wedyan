import { $bind, $static, mutable, setup, Snippet, template } from '@airlib/react';
import { DescriptionList, Gallery } from '@airlib/react-aui';
import { MarkdownRenderer } from '@airlib/react-aui/markdown';
import type { ChatDocument, MemoDocument, StillDocument } from '@/lib/documents/types.js';
import { shortDate } from './library.js';

type DocumentViewProps<D> = {
  document: D;
  /** Opens another document, by path, in its own view. */
  open: (path: string) => void;
};

/**
 * A `.still` open: the attempt it shows, large, with how it was asked for; every attempt beneath,
 * any of which can be picked to show instead, for this session; and the edits made to it.
 */
export const StillView = setup<DocumentViewProps<StillDocument>>((props) => {
  const view = mutable({ chosen: $static(() => props.document.chosen) });
  const chosen = () => props.document.attempts.find((attempt) => attempt.id === view.chosen) ?? props.document.attempts[0];

  return () => (
    <div className="wedyan-document wedyan-still">
      <Snippet>{() => <img className="wedyan-still-picture" src={chosen()?.src} alt={props.document.name} />}</Snippet>
      <section className="wedyan-document-section" aria-label="Prompt">
        <Snippet>{() => <blockquote>{chosen()?.prompt ?? props.document.prompt}</blockquote>}</Snippet>
        <DescriptionList
          size="sm"
          items={[
            { label: 'Attempts', value: String(props.document.attempts.length) },
            { label: 'Edits', value: String(props.document.edits.length) },
            { label: 'Updated', value: shortDate(props.document.updated) },
          ]}
        />
      </section>
      <section className="wedyan-document-section" aria-label="Attempts">
        <h3>Attempts</h3>
        <Gallery
          label="Attempts"
          value={$bind(view, 'chosen')}
          items={props.document.attempts.map((attempt, at) => ({
            value: attempt.id,
            src: attempt.src,
            alt: `Attempt ${at + 1}`,
            title: `Attempt ${at + 1}`,
            description: attempt.id === props.document.chosen ? 'Chosen' : shortDate(attempt.created),
          }))}
        />
      </section>
      {props.document.edits.length > 0 && (
        <section className="wedyan-document-section" aria-label="Edits">
          <h3>Edits</h3>
          <ol className="wedyan-still-edits">
            {props.document.edits.map((edit) => (
              <li key={edit.id}>
                <span className="wedyan-still-edit-kind">{EDIT_KINDS[edit.kind]}</span>
                {edit.prompt && <span>{edit.prompt}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}, 'StillView');

const EDIT_KINDS: Record<StillDocument['edits'][number]['kind'], string> = {
  mask: 'Masked a region',
  inpaint: 'Painted over',
  outpaint: 'Extended',
  upscale: 'Upscaled',
};

/**
 * A `.chat` open: its messages in order, each person's and agent's apart, with what they attached
 * as documents that open in their own views.
 */
export const ChatView = template<DocumentViewProps<ChatDocument>>(
  (props) => (
    <ol className="wedyan-document wedyan-chat" aria-label={props.document.name}>
      {props.document.messages.map((message) => (
        <li key={message.id} className="wedyan-chat-message" data-role={message.role}>
          <span className="wedyan-chat-author">{message.role === 'agent' ? 'Wedyan' : 'You'}</span>
          {message.parts.map((part, at) =>
            part.kind === 'text' ? (
              <p key={at}>{part.text}</p>
            ) : (
              <button key={at} type="button" className="wedyan-chat-attachment" onClick={() => props.open(part.path)}>
                {part.name ?? part.path.split('/').pop()}
              </button>
            )
          )}
        </li>
      ))}
    </ol>
  ),
  'ChatView'
);

/**
 * A `.memo` open: what it is about and who wrote it — an agent's with the ask it came from — then
 * its words.
 */
export const MemoView = template<DocumentViewProps<MemoDocument>>((props) => {
  const memo = props.document;
  return (
    <article className="wedyan-document wedyan-memo">
      <DescriptionList
        size="sm"
        items={[
          { label: 'Kind', value: `${memo.kind[0].toUpperCase()}${memo.kind.slice(1)}` },
          { label: 'By', value: memo.author.kind === 'agent' ? 'Wedyan' : 'You' },
          ...(memo.author.kind === 'agent' && memo.author.ask ? [{ label: 'From', value: memo.author.ask }] : []),
          ...(memo.tags?.length ? [{ label: 'Tags', value: memo.tags.join(', ') }] : []),
          ...(memo.remind ? [{ label: 'Remind', value: shortDate(memo.remind) }] : []),
          { label: 'Updated', value: shortDate(memo.updated) },
        ]}
      />
      <MarkdownRenderer text={memo.body} />
    </article>
  );
}, 'MemoView');
