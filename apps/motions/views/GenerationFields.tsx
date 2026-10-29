import { $bind, Snippet, setup, template } from '@airlib/react';
import { EmptyState, Listbox, ListboxOption, Select, Stepper, TextInput } from '@airlib/react-aui';
import type { ReactNode } from 'react';
import { follow } from '@/lib/documents/store.js';
import type { GenerativeDocument, PersonaDocument, SoundDocument } from '@/lib/documents/types.js';
import { ASPECTS, chosenAttempt, isGenerative, MODELS, settingsOf } from './generation.js';
import { GenerativeIcon, SoundIcon } from './icons.js';
import { showAttempt } from './placement.js';
import { type GenerativeClip, generativeClip, type MotionsSession, sessionCtx } from './session.js';

/** What a generated sound can be. */
const SOUND_KINDS: Record<SoundDocument['kind'], string> = { music: 'Music', speech: 'Speech', sfx: 'Sound effect', ambience: 'Ambience' };

/**
 * The picked generated clip as it was asked for, to change and make again: its prompt; its
 * settings — the model, and the aspect ratio of a picture or how long a video or a sound runs;
 * the references it was made from; who's in it; and every attempt, newest first, where picking one
 * makes the clip show it. It finds the clip in the window's session itself. Shows how to get there
 * while no single generated clip is picked.
 */
export const GenerationFields = setup(() => {
  const session = sessionCtx.get() as MotionsSession;

  return () => (
    <Snippet data={() => generativeClip(session)}>
      {(clip) =>
        clip ? (
          <div className="wedyan-compose-properties-fields">
            {promptGroup(clip)}
            {settingsGroup(clip)}
            {referencesGroup(clip)}
            {castsGroup(clip)}
            {historyGroup(clip)}
          </div>
        ) : (
          <EmptyState size="sm" title="No generated clip picked" description="Pick one generated image, video or sound to see how it was made.">
            <EmptyState.Snippet for="icon">{() => <GenerativeIcon />}</EmptyState.Snippet>
          </EmptyState>
        )
      }
    </Snippet>
  );
}, 'GenerationFields');

/**
 * A group: its name over what it holds.
 *
 * @param label - Its name.
 * @param children - What it holds.
 * @returns The group.
 */
const group = (label: string, children: ReactNode) => (
  <div role="group" aria-label={label} className="wedyan-compose-property-group">
    <div className="wedyan-compose-property-head">
      <span className="wedyan-compose-property-label" aria-hidden="true">
        {label}
      </span>
    </div>
    {children}
  </div>
);

/** What the generation is asked, written onto its document; speech also says its words. */
const promptGroup = ({ source }: GenerativeClip) =>
  group(
    'Prompt',
    <>
      {source.type === 'sound' && source.kind === 'speech' && (
        <TextInput size="xs" multiline rows={3} label="Words" placeholder="The words it says" value={$bind(source, 'text')} />
      )}
      <TextInput size="xs" multiline rows={4} label="Prompt" value={$bind(source, 'prompt')} />
    </>
  );

/** The model, a sound's kind, then a picture's aspect ratio or how long a video or a sound runs. */
const settingsGroup = ({ source }: GenerativeClip) => {
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
    </>
  );
};

/** What it was made from, each as its picture, or its name when it has none. */
const referencesGroup = ({ path, source }: GenerativeClip) =>
  group(
    'References',
    source.references?.length ? (
      <ul className="wedyan-compose-thumbs">
        {source.references.map((reference) => (
          <li key={reference} title={reference}>
            <Thumb src={pictureOf(path, reference)} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="wedyan-compose-property-note">Made from the prompt alone.</p>
    )
  );

/**
 * Who's in it, each their first look and name — for speech, who says the words — and one whose
 * file is gone drops out. A sound other than speech has no one in it.
 */
const castsGroup = ({ path, source }: GenerativeClip) => {
  if (source.type === 'sound' && source.kind !== 'speech') return null;
  const speech = source.type === 'sound';
  const casts = (speech ? (source.voice ? [source.voice] : []) : (source.casts ?? []))
    .map((cast) => follow<'persona'>(path, cast))
    .filter((found): found is { path: string; document: PersonaDocument } => !!found.document);
  return group(
    speech ? 'Voice' : 'Casts',
    casts.length ? (
      <ul className="wedyan-compose-casts">
        {casts.map((cast) => (
          <li key={cast.path} title={cast.document.description ?? cast.document.name}>
            <Thumb src={cast.document.looks[0] && pictureOf(cast.path, cast.document.looks[0])} />
            <span>{cast.document.name}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="wedyan-compose-property-note">{speech ? 'No one says it yet.' : 'No one is cast in it.'}</p>
    )
  );
};

/**
 * Every attempt, newest first: its picture, what it was asked when that differs from the prompt,
 * and when. The chosen one is picked; picking another chooses it, and the clip shows it.
 */
const historyGroup = ({ segment, source }: GenerativeClip) => {
  const choice = {
    get value() {
      return chosenAttempt(source)?.id ?? '';
    },
    set value(id: string) {
      showAttempt(segment, source, id);
    },
  };
  return group(
    'History',
    <Listbox size="xs" label="Attempts" value={$bind(choice, 'value')}>
      {[...source.attempts].reverse().map((attempt) => (
        <ListboxOption key={attempt.id} value={attempt.id}>
          <span className="wedyan-compose-attempt">
            <Thumb src={attemptPicture(source, attempt)} sound={source.type === 'sound'} />
            <span className="wedyan-compose-attempt-text">
              <span>{attempt.prompt ?? 'As prompted'}</span>
              <time dateTime={attempt.created}>{when(attempt.created)}</time>
            </span>
          </span>
        </ListboxOption>
      ))}
    </Listbox>
  );
};

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
 * The picture a written path or address shows: a still's chosen attempt, a take's poster, a
 * persona's first look, or the address itself when it's no document.
 *
 * @param from - The path of the document it's written in.
 * @param reference - The path or address, as written.
 * @returns Its picture's address, if it has one.
 */
function pictureOf(from: string, reference: string): string | undefined {
  const found = follow(from, reference);
  const document = found.document;
  if (!document) return reference;
  if (isGenerative(document)) return attemptPicture(document, chosenAttempt(document));
  if (document.type === 'persona') return document.looks[0] && pictureOf(found.path, document.looks[0]);
}

/**
 * An attempt's picture: a still's own, a take's poster; a sound has none.
 *
 * @param source - The generated document.
 * @param attempt - One of its attempts.
 * @returns Its picture's address, if it has one.
 */
function attemptPicture(source: GenerativeDocument, attempt?: GenerativeDocument['attempts'][number]): string | undefined {
  if (!attempt || source.type === 'sound') return;
  return source.type === 'still' ? attempt.src : (attempt as { poster?: string }).poster;
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
