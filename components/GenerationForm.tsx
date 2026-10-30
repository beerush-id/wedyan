import { $bind, Snippet, setup, template } from '@airlib/react';
import { Button, Listbox, ListboxOption, Select, Stepper, TextInput, Tooltip } from '@airlib/react-aui';
import { AddIcon, CloseIcon } from '@airlib/react-aui/icons';
import type { ReactNode } from 'react';
import { ASPECTS, attemptPicture, chosenAttempt, MODELS, pictureAt, reuseAttempt, settingsOf } from '@/lib/documents/generation.js';
import { follow } from '@/lib/documents/store.js';
import type { GeneratedAttempt, GenerativeDocument, PersonaDocument, SoundDocument } from '@/lib/documents/types.js';
import { ConfirmButton } from './ConfirmButton.js';
import { type GenerationSubject, generationCtx } from './generation.js';
import { GenerativeIcon, SoundIcon } from './icons.js';
import { PeopleTile } from './PeopleTile.js';

/** What a generated sound can be. */
const SOUND_KINDS: Record<SoundDocument['kind'], string> = { music: 'Music', speech: 'Speech', sfx: 'Sound effect', ambience: 'Ambience' };

/**
 * A generated image, video or sound as it was asked for, to change and make again: its prompt; its
 * settings — the model, and the aspect ratio of a picture or how long a video or a sound runs; the
 * references it was made from; who's in it; and every attempt, newest first, where picking one
 * chooses it. It finds what it works on in the context; nothing shows while there's no document.
 */
export const GenerationForm = setup(() => {
  const subject = generationCtx.get() as GenerationSubject;

  return () => (
    <Snippet data={() => subject.source}>
      {(source) =>
        source ? (
          <div className="wedyan-compose-properties-fields">
            {promptGroup(source, subject)}
            {settingsGroup(source)}
            {referencesGroup(source, subject)}
            {castsGroup(source, subject)}
            {historyGroup(source, subject)}
          </div>
        ) : null
      }
    </Snippet>
  );
}, 'GenerationForm');

/**
 * One group of a generation panel: its name over what it holds — set apart on a card of its own,
 * as a history's list is, when asked — for any panel that makes something from a prompt.
 */
export const GenerationGroup = template<{ label: string; card?: boolean; children?: ReactNode }>(
  ({ label, card, children }) => (
    <div role="group" aria-label={label} className="wedyan-compose-property-group">
      <div className="wedyan-compose-property-head">
        <span className="wedyan-compose-property-label" aria-hidden="true">
          {label}
        </span>
      </div>
      {card ? <div className="wedyan-compose-property-card">{children}</div> : children}
    </div>
  ),
  'GenerationGroup'
);

/**
 * A group of this form.
 *
 * @param label - Its name.
 * @param children - What it holds.
 * @param card - Whether what it holds sits on its own card.
 * @returns The group.
 */
const group = (label: string, children: ReactNode, card = false) => (
  <GenerationGroup label={label} card={card}>
    {children}
  </GenerationGroup>
);

/** What the generation is asked, written onto its document — speech also says its words — and Generate, to make it again. */
const promptGroup = (source: GenerativeDocument, subject: GenerationSubject) =>
  group(
    'Prompt',
    <>
      {source.type === 'sound' && source.kind === 'speech' && (
        <TextInput size="xs" multiline rows={3} label="Words" placeholder="The words it says" value={$bind(source, 'text')} />
      )}
      <TextInput size="xs" multiline rows={4} label="Prompt" value={$bind(source, 'prompt')} />
      <Button size="sm" variant="filled" className="wedyan-compose-generate" onClick={() => subject.generate()}>
        <GenerativeIcon />
        <span>Generate</span>
      </Button>
    </>
  );

/**
 * The model, a sound's kind, then a picture's aspect ratio, how many images one request makes, or
 * how long a video or a sound runs.
 */
const settingsGroup = (source: GenerativeDocument) => {
  const settings = settingsOf(source);
  const models = MODELS[source.type];
  return group(
    'Settings',
    <>
      {source.type === 'sound' && (
        <div className="wedyan-compose-property-row">
          <span>Kind</span>
          <Select size="xs" label="Kind" options={SOUND_KINDS} value={$bind(source, 'kind')}>
            <Select.Snippet for="trigger">{(value) => <span>{SOUND_KINDS[value as SoundDocument['kind']]}</span>}</Select.Snippet>
          </Select>
        </div>
      )}
      <div className="wedyan-compose-property-row">
        <span>Model</span>
        <Select size="xs" label="Model" options={models} value={$bind(settings, 'model')}>
          <Select.Snippet for="trigger">{(value) => <span>{models[value as string]}</span>}</Select.Snippet>
        </Select>
      </div>
      {source.type !== 'sound' && (
        <div className="wedyan-compose-property-row">
          <span>Aspect ratio</span>
          <Select size="xs" label="Aspect ratio" options={ASPECTS} value={$bind(settings, 'aspect')}>
            <Select.Snippet for="trigger">{(value) => <span>{value as string}</span>}</Select.Snippet>
          </Select>
        </div>
      )}
      {source.type === 'still' && (
        <div className="wedyan-compose-property-row">
          <span>Batch size</span>
          <Stepper
            size="xs"
            label="Batch size"
            decrementLabel="Smaller batch"
            incrementLabel="Larger batch"
            min={1}
            max={4}
            value={$bind(settings, 'batch')}
          />
        </div>
      )}
      {source.type !== 'still' && (
        <div className="wedyan-compose-property-row">
          <span>Seconds</span>
          <Stepper
            size="xs"
            label="Seconds"
            decrementLabel="Shorter"
            incrementLabel="Longer"
            min={1}
            max={source.type === 'sound' ? 60 : 10}
            value={$bind(settings, 'seconds')}
          />
        </div>
      )}
    </>,
    true
  );
};

/** What it was made from, each as its picture, or its name when it has none. */
const referencesGroup = (source: GenerativeDocument, subject: GenerationSubject) =>
  group(
    'References',
    <ul className="wedyan-compose-thumbs">
      <Snippet>
        {() =>
          (source.references ?? []).map((reference) => (
            <li key={reference} title={reference} className="wedyan-compose-reference">
              <Thumb src={pictureAt(subject.path ?? '', reference)} />
              {/* Taking it off, once confirmed: small, over the picture's middle, while it's hovered or focused. */}
              <span className="wedyan-compose-reference-remove">
                <ConfirmButton
                  label="Remove reference"
                  size="xs"
                  variant="glass"
                  title={() => 'Remove reference?'}
                  description="It's taken off what this is made from. The image itself stays where it is."
                  action="Remove"
                  onconfirm={() => removeReference(source, reference)}
                >
                  <CloseIcon />
                  <Tooltip>Remove reference</Tooltip>
                </ConfirmButton>
              </span>
            </li>
          ))
        }
      </Snippet>
      <li>
        <ReferenceAdd source={source} />
      </li>
    </ul>,
    true
  );

/**
 * Takes one of a generation's references off it.
 *
 * @param source - The generated document.
 * @param reference - The reference, as written.
 */
function removeReference(source: GenerativeDocument, reference: string): void {
  const references = source.references ?? [];
  const at = references.indexOf(reference);
  if (at >= 0) references.splice(at, 1);
}

/**
 * Adding references: a tile, always at the end, picking from the user's own files — images, or
 * sounds for a sound — each added as it's picked.
 */
const ReferenceAdd = template<{ source: GenerativeDocument }>(
  ({ source }) => (
    <label className="wedyan-compose-thumb wedyan-compose-thumb-add" title="Add reference">
      <AddIcon />
      <input
        type="file"
        multiple
        accept={source.type === 'sound' ? 'audio/*' : 'image/*'}
        aria-label="Add reference"
        className="wedyan-compose-thumb-file"
        onChange={(event) => {
          const input = event.currentTarget;
          // Until the drive takes uploads, a picked file is referenced where the browser keeps it.
          const added = [...(input.files ?? [])].map((file) => URL.createObjectURL(file));
          (source.references ??= []).push(...added);
          input.value = '';
        }}
      />
    </label>
  ),
  'ReferenceAdd'
);

/**
 * Who's in it, each a tile picking which of their pictures it takes — for speech, who says the words, by
 * portrait and name — and one whose file is gone drops out. A sound other than speech has no one in it.
 */
const castsGroup = (source: GenerativeDocument, subject: GenerationSubject) => {
  if (subject.casts === false || (source.type === 'sound' && source.kind !== 'speech')) return null;
  const speech = source.type === 'sound';
  const path = subject.path ?? '';
  const casts = (speech ? (source.voice ? [source.voice] : []) : (source.casts ?? []))
    .map((cast) => follow<'persona'>(path, cast))
    .filter((found): found is { path: string; document: PersonaDocument } => !!found.document);
  const portraitOf = (cast: { path: string; document: PersonaDocument }) =>
    cast.document.head?.main && pictureAt(cast.path, cast.document.head.main);
  if (!casts.length) {
    return group(
      speech ? 'Voice' : 'Casts',
      <p className="wedyan-compose-property-note">{speech ? 'No one says it yet.' : 'No one is cast in it.'}</p>,
      true
    );
  }
  // A voice is who says the words, a row; someone cast is a tile picking which of their pictures it takes.
  return group(
    speech ? 'Voice' : 'Casts',
    speech ? (
      <ul className="wedyan-compose-casts">
        {casts.map((cast) => (
          <li key={cast.path} title={cast.document.description ?? cast.document.name}>
            <Thumb src={portraitOf(cast)} />
            <span>{cast.document.name}</span>
          </li>
        ))}
      </ul>
    ) : (
      <ul className="wedyan-people-tiles">
        {casts.map((cast) => (
          <li key={cast.path}>
            <PeopleTile persona={cast.document} pictureOf={(source) => pictureAt(cast.path, source)} />
          </li>
        ))}
      </ul>
    ),
    true
  );
};

/**
 * Every attempt, newest first: its picture, the prompt and settings it was made with, and when, and
 * reusing those in place of the current ones. The chosen one is picked; picking another chooses it.
 */
const historyGroup = (source: GenerativeDocument, subject: GenerationSubject) => {
  const choice = {
    get value() {
      return chosenAttempt(source)?.id ?? '';
    },
    set value(id: string) {
      subject.choose(id);
    },
  };
  return group(
    'History',
    source.attempts.length ? (
      <Listbox size="xs" label="Attempts" value={$bind(choice, 'value')}>
        {[...source.attempts].reverse().map((attempt) => (
          <ListboxOption key={attempt.id} value={attempt.id}>
            <span className="wedyan-compose-attempt">
              <Thumb src={attemptPicture(source, attempt)} sound={source.type === 'sound'} />
              <span className="wedyan-compose-attempt-text">
                <span>{attempt.prompt}</span>
                <span>{settingsLine(source, attempt)}</span>
                <time dateTime={attempt.created}>{when(attempt.created)}</time>
              </span>
              {/* Asks again what this attempt asked: its prompt and settings replace the current ones. */}
              <span className="wedyan-compose-attempt-reuse" ref={pressedApart(() => reuseAttempt(source, attempt))}>
                <Button size="xs" variant="text" aria-label="Reuse this attempt's prompt and settings">
                  Reuse
                </Button>
              </span>
            </span>
          </ListboxOption>
        ))}
      </Listbox>
    ) : (
      <p className="wedyan-compose-property-note">Nothing made yet.</p>
    )
  );
};

/** What a press on a control inside a history row is made of, kept from the row. */
const ROW_PRESS = ['pointerdown', 'mousedown', 'click', 'keydown'];

/**
 * A control in a history row, pressed apart from the row: its press does what it's for and goes no
 * further, so it doesn't choose the row too. The row listens on its own element, before the page's
 * handlers would, so this listens natively on the element around the control and acts there.
 *
 * @param run - What pressing the control does.
 * @returns The ref for the element around the control.
 */
function pressedApart(run: () => void): (element: HTMLElement | null) => void {
  return (element) => {
    if (!element || element.dataset.apart) return;
    element.dataset.apart = 'true';
    for (const type of ROW_PRESS) {
      element.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type === 'click') run();
      });
    }
  };
}

/** A small square picture, or a blank — a sound's glyph for a sound — when there's none. */
const Thumb = template<{ src?: string; sound?: boolean }>(
  ({ src, sound }) =>
    src ? (
      <img className="wedyan-compose-thumb" src={src} alt="" />
    ) : (
      <span className="wedyan-compose-thumb" data-blank>
        {sound && <SoundIcon />}
      </span>
    ),
  'Thumb'
);

/**
 * The settings an attempt was made with, in a line: its model by name, then its aspect ratio or how long it runs.
 *
 * @param source - The generated document.
 * @param attempt - One of its attempts.
 * @returns E.g. `Detailed · 16:9` or `Standard · 30s`.
 */
function settingsLine(source: GenerativeDocument, attempt: GeneratedAttempt): string {
  const { model, aspect, seconds } = attempt.settings;
  return [model && (MODELS[source.type][model] ?? model), aspect, seconds && `${seconds}s`].filter(Boolean).join(' · ');
}

/**
 * When an attempt was made, short: its date and time.
 *
 * @param created - When, as an ISO date.
 * @returns E.g. `Oct 27, 2026, 9:31 AM`.
 */
function when(created: string): string {
  return new Date(created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
