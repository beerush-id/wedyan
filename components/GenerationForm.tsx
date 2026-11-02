import { $bind, $use, Snippet, setup, template } from '@airlib/react';
import {
  Button,
  Listbox,
  ListboxOption,
  Menu,
  Select,
  SelectOption,
  SelectPanel,
  SelectTrigger,
  Stepper,
  TextInput,
  Toggle,
  ToggleGroup,
  Tooltip,
} from '@airlib/react-aui';
import { AddIcon, CloseIcon } from '@airlib/react-aui/icons';
import { IRPCFile } from '@irpclib/irpc';
import type { ReactNode } from 'react';
import {
  ASPECTS,
  asksSeconds,
  attemptPicture,
  chosenAttempt,
  GENERATION_MODES,
  MAKES_VIDEO,
  MODELS,
  pictureAt,
  reuseAttempt,
  settingsOf,
  TIERED_MODELS,
} from '@/lib/documents/generation.js';
import { nameOf, newId, parentOf } from '@/lib/documents/paths.js';
import type { GeneratedAttempt, GenerativeDocument, PersonaDocument, SoundDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { follow } from '@/lib/share/documents.js';
import { ConfirmButton } from './ConfirmButton.js';
import { type GenerationSubject, generationCtx } from './generation.js';
import { GenerativeIcon, SoundIcon } from './icons.js';
import { PeopleTile } from './PeopleTile.js';

/** What a generated sound can be. */
const SOUND_KINDS: Record<SoundDocument['kind'], string> = { music: 'Music', speech: 'Speech', sfx: 'Sound effect', ambience: 'Ambience' };

/** The only kind of sound Generate can make. */
const SPOKEN = 'speech';

/** The longest edge a small square picture is asked for at, as `dfs.image` serves it. */
const THUMB_SIZE = 128;

/** The dashed box everything added to a generation is added from, whatever its icon. */
const ADD_TILE = 'wedyan-compose-thumb wedyan-compose-thumb-add';

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
      <div className="wedyan-compose-property-head pi-sm">
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

/**
 * What the generation is asked, written onto its document — speech also says its words — and
 * Generate, to make it again. A take says first whether that makes a picture or the video itself,
 * so what's asked can be got right before the expensive part.
 */
const promptGroup = (source: GenerativeDocument, subject: GenerationSubject) =>
  group(
    'Prompt',
    <>
      {source.type === 'take' && (
        <ToggleGroup aria-label="Generate as" size="xs" className="wedyan-compose-mode" value={$bind(settingsOf(source), 'mode')}>
          {Object.entries(GENERATION_MODES).map(([mode, label]) => (
            <Toggle key={mode} value={mode} disabled={mode === 'video' && !MAKES_VIDEO}>
              {label}
            </Toggle>
          ))}
        </ToggleGroup>
      )}
      {source.type === 'sound' && source.kind === 'speech' && (
        <TextInput size="xs" multiline rows={3} label="Words" placeholder="The words it says" value={$bind(source, 'text')} />
      )}
      <TextInput size="xs" multiline rows={4} label="Prompt" value={$bind(source, 'prompt')} />
      <Button
        size="sm"
        variant="filled"
        className="wedyan-compose-generate"
        disabled={$use(() => !!subject.busy || !(source.type === 'sound' && source.kind === 'speech' ? source.text : source.prompt)?.trim())}
        onClick={() => subject.generate()}
      >
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
        <div className="wedyan-compose-property-row pi-sm">
          <span>Kind</span>
          <Select size="xs" label="Kind" value={$bind(source, 'kind')}>
            <SelectTrigger label="Kind">{() => <span>{SOUND_KINDS[source.kind]}</span>}</SelectTrigger>
            <SelectPanel>
              {Object.entries(SOUND_KINDS).map(([kind, label]) => (
                <SelectOption key={kind} value={kind} disabled={kind !== SPOKEN}>
                  {label}
                </SelectOption>
              ))}
            </SelectPanel>
          </Select>
        </div>
      )}
      <div className="wedyan-compose-property-row pi-sm">
        <span>Model</span>
        <Select size="xs" label="Model" disabled={!TIERED_MODELS} options={models} value={$bind(settings, 'model')}>
          <Select.Snippet for="trigger">{(value) => <span>{models[value as string]}</span>}</Select.Snippet>
        </Select>
      </div>
      {source.type !== 'sound' && (
        <div className="wedyan-compose-property-row pi-sm">
          <span>Aspect ratio</span>
          <Select size="xs" label="Aspect ratio" options={ASPECTS} value={$bind(settings, 'aspect')}>
            <Select.Snippet for="trigger">{(value) => <span>{value as string}</span>}</Select.Snippet>
          </Select>
        </div>
      )}
      {source.type === 'still' && (
        <div className="wedyan-compose-property-row pi-sm">
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
      <Snippet>
        {() =>
          asksSeconds(source) && (
            <div className="wedyan-compose-property-row pi-sm">
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
          )
        }
      </Snippet>
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
            <li key={reference} title={reference} className="wedyan-compose-removable">
              <Thumb src={pictureAt(subject.path ?? '', reference)} />
              <TileRemove
                label="Remove reference"
                description="It's taken off what this is made from. The image itself stays where it is."
                onconfirm={() => removeFrom(source.references, reference)}
              />
            </li>
          ))
        }
      </Snippet>
      <li>
        <ReferenceAdd source={source} path={subject.path} />
      </li>
      {source.type !== 'sound' && (
        <li>
          <ReferencePick source={source} subject={subject} />
        </li>
      )}
    </ul>,
    true
  );

/** Taking a tile off what a generation is made from, once confirmed: small, floating at its top right, while it's hovered or focused. */
const TileRemove = template<{ label: string; description: string; onconfirm(): void }>(
  ({ label, description, onconfirm }) => (
    <span className="wedyan-compose-remove">
      <ConfirmButton label={label} size="xs" variant="glass" title={() => `${label}?`} description={description} action="Remove" onconfirm={onconfirm}>
        <CloseIcon />
        <Tooltip>{label}</Tooltip>
      </ConfirmButton>
    </span>
  ),
  'TileRemove'
);

/**
 * Takes one path off what a generation is made from.
 *
 * @param list - Its references or casts.
 * @param path - The path, as written.
 */
function removeFrom(list: string[] | undefined, path: string): void {
  const at = list?.indexOf(path) ?? -1;
  if (at >= 0) list?.splice(at, 1);
}

/**
 * Adding references: a tile, always at the end, picking from the user's own files, each added as
 * it's picked. A sound's model takes none, so its tile can't be used.
 */
const ReferenceAdd = template<{ source: GenerativeDocument; path?: string }>(
  ({ source, path }) => (
    <label className={ADD_TILE} title="Add reference">
      <AddIcon />
      <input
        type="file"
        multiple
        accept={source.type === 'sound' ? 'audio/*' : 'image/*'}
        disabled={source.type === 'sound'}
        aria-label="Add reference"
        className="wedyan-compose-thumb-file"
        onChange={(event) => {
          const input = event.currentTarget;
          for (const file of Array.from(input.files ?? [])) {
            void storeReference(file, path).then((address) => (source.references ??= []).push(address));
          }
          input.value = '';
        }}
      />
    </label>
  ),
  'ReferenceAdd'
);

/** Adding a reference from the pictures on hand: what isn't one already, and never what's being made. */
const ReferencePick = setup<{ source: GenerativeDocument; subject: GenerationSubject }>((props) => {
  const items = () =>
    (props.subject.pictures ?? [])
      .filter(({ path }) => path !== props.subject.path && !props.source.references?.includes(path))
      .map(({ path, name }) => ({ name: path, label: name }));

  return () => (
    <Snippet>
      {() =>
        items().length ? (
          <Menu
            label="Pick a reference"
            size="xs"
            variant="text"
            className={ADD_TILE}
            items={$use(items)}
            oncommand={(event) => (props.source.references ??= []).push(String(event.detail))}
          >
            <Menu.Snippet for="trigger">{() => <GenerativeIcon />}</Menu.Snippet>
          </Menu>
        ) : null
      }
    </Snippet>
  );
}, 'ReferencePick');

/** Who can be put in it: everyone not in it yet. Speech has one voice, so who says the words can't be picked. */
const CastAdd = setup<{ source: GenerativeDocument; subject: GenerationSubject; casts: () => string[]; add(path: string): void }>((props) => {
  const items = () =>
    (props.subject.people ?? [])
      .filter(({ path }) => !props.casts().includes(path))
      .map(({ path, name }) => ({ name: path, label: name }));

  return () => (
    <Snippet>
      {() =>
        items().length ? (
          <Menu
            label="Add cast"
            size="xs"
            variant="text"
            className={ADD_TILE}
            disabled={props.source.type === 'sound'}
            items={$use(items)}
            oncommand={(event) => props.add(String(event.detail))}
          >
            <Menu.Snippet for="trigger">{() => <AddIcon />}</Menu.Snippet>
          </Menu>
        ) : null
      }
    </Snippet>
  );
}, 'CastAdd');

/**
 * Stores a picked file beside what it's a reference of, as a part of it that lists as nothing.
 *
 * @param file - The file.
 * @param path - The document it's a reference of, if it has a place yet.
 * @returns Where it's delivered from.
 */
async function storeReference(file: File, path?: string): Promise<string> {
  const stored = `${path ? parentOf(path) : '~'}/${newId()}.${file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()}`;
  const content = new IRPCFile({ name: nameOf(stored), size: file.size, type: file.type }, file);
  await dfs.write(stored, content, { metadata: { part: 'true' } });
  return `/~${stored.slice(1)}`;
}

/**
 * Who's in it, each a tile picking which of their pictures it takes — for speech, who says the words, by
 * portrait and name — and one whose file is gone drops out. A sound other than speech has no one in it.
 */
const castsGroup = (source: GenerativeDocument, subject: GenerationSubject) => {
  if (subject.casts === false || (source.type === 'sound' && source.kind !== 'speech')) return null;
  const speech = source.type === 'sound';
  const path = subject.path ?? '';
  const written = () => (speech ? (source.voice ? [source.voice] : []) : (source.casts ?? []));
  const add = (cast: string) => {
    if (source.type === 'sound') source.voice = cast;
    else (source.casts ??= []).push(cast);
  };
  const remove = (cast: string) => {
    if (source.type === 'sound') source.voice = undefined;
    else removeFrom(source.casts, cast);
  };
  const portraitOf = (cast: { path: string; document: PersonaDocument }) =>
    cast.document.head?.main && pictureAt(cast.path, cast.document.head.main);
  // A voice is who says the words, a portrait; someone cast is a tile picking which of their pictures it takes.
  const shown = () =>
    written().flatMap((cast) => {
      const found = follow<'persona'>(path, cast);
      if (!found.document) return [];
      const person = { path: found.path, document: found.document };
      return [
        <li key={cast} className="wedyan-compose-removable" title={speech ? person.document.name : undefined}>
          {speech ? (
            <Thumb src={portraitOf(person)} />
          ) : (
            <PeopleTile persona={person.document} pictureOf={(picture) => sized(pictureAt(person.path, picture))} />
          )}
          <TileRemove
            label={speech ? 'Remove voice' : 'Remove cast'}
            description="They're taken off this. They stay where they are."
            onconfirm={() => remove(cast)}
          />
        </li>,
      ];
    });
  return group(
    speech ? 'Voice' : 'Casts',
    <ul className="wedyan-compose-thumbs">
      <Snippet>{shown}</Snippet>
      <li>
        <CastAdd source={source} subject={subject} casts={written} add={add} />
      </li>
    </ul>,
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
              <Thumb src={attemptPicture(subject.path ?? '', source, attempt)} sound={source.type === 'sound'} />
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

/**
 * A picture's address at a tile's size.
 *
 * @param src - Its address, if it has one.
 * @returns Where it's served at that size.
 */
function sized(src?: string): string | undefined {
  return src && dfs.image(src, { size: THUMB_SIZE });
}

/** A small square picture, or a blank — a sound's glyph for a sound — when there's none. */
const Thumb = template<{ src?: string; sound?: boolean }>(
  ({ src, sound }) =>
    src ? (
      <img className="wedyan-compose-thumb" src={sized(src)} alt="" />
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
