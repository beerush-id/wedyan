import { $bind, Snippet, template } from '@airlib/react';
import { DescriptionList, Gallery, TextInput } from '@airlib/react-aui';
import type { StillDocument } from '@/lib/documents/types.js';
import { shortDate } from '../../motion.js';

const EDIT_KINDS: Record<StillDocument['edits'][number]['kind'], string> = {
  mask: 'Masked a region',
  inpaint: 'Painted over',
  outpaint: 'Extended',
  upscale: 'Upscaled',
};

/**
 * A `.still`: the attempt it shows, large, with how it was asked for; every attempt beneath, any of
 * which can be chosen instead, which is saved with it; and the edits made to it.
 */
export const StillView = template<{ document: StillDocument }>(({ document }) => {
  const chosen = () => document.attempts.find((attempt) => attempt.id === document.chosen) ?? document.attempts[0];

  return (
    <div className="wedyan-document wedyan-still">
      <Snippet>{() => <img className="wedyan-still-picture" src={chosen()?.src} alt={document.name} />}</Snippet>
      <TextInput size="sm" label="Name" value={$bind(document, 'name')} className="wedyan-rename" />
      <section className="wedyan-document-section" aria-label="Prompt">
        <Snippet>{() => <blockquote>{chosen()?.prompt ?? document.prompt}</blockquote>}</Snippet>
        <DescriptionList
          size="sm"
          items={[
            { label: 'Attempts', value: String(document.attempts.length) },
            { label: 'Edits', value: String(document.edits.length) },
            { label: 'Updated', value: shortDate(document.updated) },
          ]}
        />
      </section>
      <section className="wedyan-document-section" aria-label="Attempts">
        <h3>Attempts</h3>
        <Gallery
          label="Attempts"
          value={$bind(document, 'chosen')}
          items={document.attempts.map((attempt, at) => ({
            value: attempt.id,
            src: attempt.src,
            alt: `Attempt ${at + 1}`,
            title: `Attempt ${at + 1}`,
            description: attempt.id === document.chosen ? 'Chosen' : shortDate(attempt.created),
          }))}
        />
      </section>
      {document.edits.length > 0 && (
        <section className="wedyan-document-section" aria-label="Edits">
          <h3>Edits</h3>
          <ol className="wedyan-still-edits">
            {document.edits.map((edit) => (
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
