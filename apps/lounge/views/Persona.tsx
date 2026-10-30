import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, $use, createContext, For, mutable, Show, Snippet, setup } from '@airlib/react';
import { Avatar, Button, EmptyState, Listbox, ListboxOption, Select, Switch, TextInput, Tooltip } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { ReactNode } from 'react';
import { ConfirmButton } from '@/components/ConfirmButton.js';
import { FloatingDownload } from '@/components/FloatingDownload.js';
import { generationCtx } from '@/components/generation.js';
import { GenerationForm, GenerationGroup } from '@/components/GenerationForm.js';
import { GenerativeIcon } from '@/components/icons.js';
import { WRITING_MODELS } from '@/lib/documents/generation.js';
import type { PersonaDocument } from '@/lib/documents/types.js';
import { system } from '@/lib/systems/system.js';
import { AddIcon, CloseIcon, DeleteIcon, ImageIcon, PeopleIcon, PersonIcon } from './icons.js';
import { edit, KINDS, newStill, type PersonaKind, personaAt, personalityOf, pictureOf, portraitOf, stillAt } from './library.js';
import { type LoungeSession, loungeCtx, PERSON_TABS, type PersonTab } from './session.js';

/** The id naming the Profile's attach-defaults switch, and its hint as `-hint` after it. */
const ATTACH_ID = 'wedyan-lounge-attach-defaults';

/** How long who a persona is may run: the format keeps a description under 256 characters. */
const DESCRIPTION_MAX = 255;

/**
 * A persona's three sides, each a main picture and others: the head, which close-ups are made
 * from; the body, for full shots; and the wardrobe, its default outfit and the others.
 */
type Part = Exclude<PersonTab, 'profile'>;

/** One side as written: its main picture, and the others — a look's poses, or the wardrobe's outfits. */
type Side = { main: string; poses?: string[]; outfits?: string[] };

/**
 * What each side's main picture and its others are called and kept under, what an empty main
 * picture invites and its button says, what making another the main one and taking one away say,
 * and the shape its pictures are made in.
 */
const PARTS: Record<
  Part,
  {
    main: string;
    other: string;
    others: 'poses' | 'outfits';
    empty: string;
    hint: string;
    add: string;
    addOther: string;
    othersLabel: string;
    promote: string;
    remove: string;
    removeHint: string;
    aspect: string;
  }
> = {
  head: {
    main: 'Face',
    other: 'Face pose',
    others: 'poses',
    empty: 'No face yet',
    hint: 'Close-ups are made from it, and it’s their portrait.',
    add: 'Add face',
    addOther: 'Add pose',
    othersLabel: 'Poses — expressions and angles of their face',
    promote: 'Make face',
    remove: 'Remove pose',
    removeHint: 'It’s taken off their poses. Its still stays in their folder.',
    aspect: '1:1',
  },
  body: {
    main: 'Figure',
    other: 'Figure pose',
    others: 'poses',
    empty: 'No figure yet',
    hint: 'Full shots are made from it.',
    add: 'Add figure',
    addOther: 'Add pose',
    othersLabel: 'Poses — stances and angles of their figure',
    promote: 'Make figure',
    remove: 'Remove pose',
    removeHint: 'It’s taken off their poses. Its still stays in their folder.',
    aspect: '16:9',
  },
  wardrobe: {
    main: 'Outfit',
    other: 'Outfit',
    others: 'outfits',
    empty: 'No outfit yet',
    hint: 'What they wear unless told otherwise.',
    add: 'Add outfit',
    addOther: 'Add outfit',
    othersLabel: 'Other outfits they can wear',
    promote: 'Make default',
    remove: 'Remove outfit',
    removeHint: 'It’s taken out of their wardrobe. Its still stays in their folder.',
    aspect: '9:16',
  },
};

/** The open persona's tab and picked picture, shared by its tabs and pictures. */
type PersonaView = {
  /** The picked picture, as the persona writes it; none on Profile, or while nothing on the tab is picked. */
  readonly picked: string | null;
  /**
   * Picks one of the tab's pictures, to see how it was made beside the persona.
   *
   * @param source - The picture, as the persona writes it.
   */
  pick(source: string): void;
};

/** The open persona's picked picture, for its pictures. */
const personaViewCtx = createContext<PersonaView>();

const CLASS = {
  PANEL: 'wedyan-lounge-open',
  TAB: 'wedyan-lounge-tab',
  GENERATION: 'wedyan-lounge-side wedyan-lounge-generation',
  PICK: 'wedyan-lounge-pick',
  SLOT: 'wedyan-lounge-slot',
  SLOT_PICTURE: 'wedyan-lounge-slot-picture',
  SLOT_FRAME: 'wedyan-lounge-slot-frame',
  HEAD: 'wedyan-lounge-editor-head',
  NAME: 'wedyan-lounge-editor-name',
  META: 'wedyan-lounge-editor-meta',
  FIELD: 'wedyan-lounge-editor-field',
  FIELD_LABEL: 'wedyan-lounge-editor-field-label',
  SECTION: 'wedyan-lounge-editor-section',
  TILES: 'wedyan-lounge-tiles',
  TILE: 'wedyan-lounge-tile',
  TILE_PICTURE: 'wedyan-lounge-tile-picture',
  SWITCH_ROW: 'wedyan-lounge-switch-row',
  SWITCH_TEXT: 'wedyan-lounge-switch-text',
  BIO: 'wedyan-lounge-bio',
  COUNT: 'wedyan-lounge-count',
  TILE_ADD: 'wedyan-lounge-tile-add',
  TILE_PROMOTE: 'wedyan-lounge-tile-promote',
  TILE_REMOVE: 'wedyan-lounge-tile-remove',
  FOOT: 'wedyan-lounge-editor-foot',
};

/**
 * The open persona, as the source its images, videos and scripts are made from, on two panels. The
 * person, by the tab the toolbar picks: Profile — who they are and how they sound —
 * then Head, Body and Wardrobe, each with its pictures. On the right, how it's made: on Profile,
 * their personality, from a prompt; on a tab of pictures, the picked one's prompt, settings,
 * references and history, where choosing an attempt changes the picture. Every change is made to
 * the persona itself, so the side sees it at once.
 */
export const PersonaEditor = setup(() => {
  const session = loungeCtx.get() as LoungeSession;
  const persona = () => (session.path ? personaAt(session.path) : undefined);
  const view = mutable({ picked: null as string | null });

  // The picked picture, while it's still one of the tab's; otherwise the tab's main picture, if it has one.
  const picked = () => {
    const document = persona();
    const { tab } = session;
    if (!document || tab === 'profile') return null;
    if (view.picked && picturesOf(document, tab).includes(view.picked)) return view.picked;
    return document[tab]?.main || null;
  };
  personaViewCtx.set({
    get picked() {
      return picked();
    },
    pick(source: string) {
      view.picked = source;
    },
  });

  // The picked picture's still, while it was made in Wedyan.
  const pickedStill = () => {
    const source = picked();
    return source && session.path ? stillAt(session.path, source) : undefined;
  };
  generationCtx.set({
    get path() {
      return pickedStill()?.path;
    },
    get source() {
      return pickedStill()?.document;
    },
    // A persona's own pictures are of the persona; no one else is cast in them.
    casts: false,
    generate() {
      // Nothing in Lounge generates yet; the prompt and settings are kept for when it does.
    },
    choose(id: string) {
      const still = pickedStill();
      if (still) still.document.chosen = id;
    },
  });

  return () => (
    <Show
      when={persona}
      fallback={() => (
        <WindowPanel surface="solid" role="region" aria-label="Person" className={CLASS.PANEL}>
          <EmptyState title="They're gone" description="They were deleted from People." level={3}>
            <EmptyState.Snippet for="icon">{() => <PeopleIcon />}</EmptyState.Snippet>
          </EmptyState>
        </WindowPanel>
      )}
    >
      {() => (
        <>
          <WindowPanel surface="solid" role="region" aria-label={$use(() => PERSON_TABS[session.tab])} className={CLASS.PANEL}>
            <Snippet data={() => session.tab}>
              {(tab) => {
                if (tab === 'profile') return <ProfileTab />;
                return <LookTab key={tab} part={tab} />;
              }}
            </Snippet>
          </WindowPanel>
          <WindowPanel role="region" aria-label="How it's made" className={CLASS.GENERATION}>
            <Snippet data={() => session.tab === 'profile'}>
              {(profile) =>
                profile ? (
                  <PersonalityForm />
                ) : (
                  <Show
                    when={picked}
                    fallback={() => (
                      <EmptyState size="sm" title="Nothing picked" description="Pick one of their pictures to see how it was made.">
                        <EmptyState.Snippet for="icon">{() => <GenerativeIcon />}</EmptyState.Snippet>
                      </EmptyState>
                    )}
                  >
                    {() => (
                      <Show
                        when={pickedStill}
                        fallback={() => (
                          <EmptyState size="sm" title="No still there" description="Its still was moved or deleted, so there's no prompt or history to show.">
                            <EmptyState.Snippet for="icon">{() => <ImageIcon />}</EmptyState.Snippet>
                          </EmptyState>
                        )}
                      >
                        {() => <GenerationForm />}
                      </Show>
                    )}
                  </Show>
                )
              }
            </Snippet>
          </WindowPanel>
        </>
      )}
    </Show>
  );
}, 'PersonaEditor');

/**
 * Who the open persona is: their portrait and name, what they are, how they sound, and who they
 * are in a line; then deleting them, once confirmed.
 */
const ProfileTab = setup(() => {
  const session = loungeCtx.get() as LoungeSession;
  const persona = () => (session.path ? personaAt(session.path) : undefined);

  /**
   * Changes the open persona and marks when it changed.
   *
   * @param apply - What to change in it.
   */
  const change = (apply: (document: PersonaDocument) => void) => changeOpen(session, apply);

  // What the fields edit: the persona's own values, read live and written straight back to it.
  // The format keeps the description and voice optional, so emptying them leaves them out.
  const fields = {
    get name() {
      return persona()?.name ?? '';
    },
    set name(name: string) {
      change((document) => (document.name = name));
    },
    get description() {
      return persona()?.description ?? '';
    },
    set description(description: string) {
      change((document) => {
        if (description) document.description = description;
        else delete document.description;
      });
    },
    get kind() {
      return persona()?.kind ?? 'person';
    },
    set kind(kind: string) {
      if (kind in KINDS) change((document) => (document.kind = kind as PersonaKind));
    },
    get voiceName() {
      return persona()?.voice?.name ?? '';
    },
    set voiceName(name: string) {
      change((document) => setVoice(document, name, document.voice?.sample ?? ''));
    },
    get attachDefault() {
      return !!persona()?.attachDefault;
    },
    set attachDefault(attach: boolean) {
      change((document) => {
        if (attach) document.attachDefault = true;
        else delete document.attachDefault;
      });
    },
  };

  const portrait = () => {
    const document = persona();
    return document && session.path ? portraitOf(session.path, document) : undefined;
  };
  return () => (
    <div className={CLASS.TAB}>
      <header className={CLASS.HEAD}>
        <Avatar src={$use(portrait)} alt={$use(() => fields.name || 'Unnamed')} size="md" />
        <TextInput label="Name" placeholder="Name" value={$bind(fields, 'name')} className={CLASS.NAME} />
      </header>
      <div className={CLASS.META}>
        <div className={CLASS.FIELD}>
          <span className={CLASS.FIELD_LABEL} aria-hidden="true">
            Kind
          </span>
          {/* The trigger shows the kind alone; "Kind" stays only as its name. */}
          <Select size="sm" label="Kind" options={KINDS} value={$bind(fields, 'kind')}>
            <Select.Snippet for="trigger">{(kind) => KINDS[kind as PersonaKind]}</Select.Snippet>
          </Select>
        </div>
        <div className={CLASS.FIELD}>
          <span className={CLASS.FIELD_LABEL} aria-hidden="true">
            Voice
          </span>
          <TextInput size="sm" label="Voice" placeholder="How they sound, e.g. Calm" value={$bind(fields, 'voiceName')} />
        </div>
      </div>
      {/* Whether casting them brings their defaults along on its own. */}
      <div className={CLASS.SWITCH_ROW}>
        <span className={CLASS.SWITCH_TEXT}>
          <span id={ATTACH_ID}>Attach defaults</span>
          <span id={`${ATTACH_ID}-hint`} className={CLASS.FIELD_LABEL}>
            When cast, their face, figure and default outfit go along as references. Off, only their face does.
          </span>
        </span>
        <Switch aria-labelledby={ATTACH_ID} aria-describedby={`${ATTACH_ID}-hint`} checked={$bind(fields, 'attachDefault')} />
      </div>
      <div className={CLASS.FIELD}>
        <span className={CLASS.FIELD_LABEL} aria-hidden="true">
          Who they are
        </span>
        <TextInput
          multiline
          rows={4}
          maxLength={DESCRIPTION_MAX}
          label="Who they are"
          placeholder="Who they are: where they come from, what they want, how they carry themselves."
          value={$bind(fields, 'description')}
          className={CLASS.BIO}
        />
        <span className={CLASS.COUNT} aria-live="polite">
          <Snippet>{() => `${fields.description.length} / ${DESCRIPTION_MAX}`}</Snippet>
        </span>
      </div>
      <footer className={CLASS.FOOT}>
        <ConfirmButton
          size="sm"
          variant="tonal"
          title={() => `Delete ${fields.name || 'this person'}?`}
          description="They're taken off People. Their pictures stay in their folder."
          action="Delete"
          onconfirm={() => session.remove()}
        >
          <DeleteIcon />
          <span>Delete person</span>
        </ConfirmButton>
      </footer>
    </div>
  );
}, 'ProfileTab');

/**
 * How the open persona's personality is made: the prompt describing them, the writing model it's
 * asked of, and every try, newest first, where picking one chooses it.
 */
const PersonalityForm = setup(() => {
  const session = loungeCtx.get() as LoungeSession;
  // The editor is made afresh for each persona, so whose personality it is never changes under it.
  const personality = $static(() => personalityOf(session.path ?? ''));
  const models: Record<string, string> = WRITING_MODELS;

  return () => (
    <div className="wedyan-compose-properties-fields">
      <GenerationGroup label="Prompt">
        <TextInput
          size="xs"
          multiline
          rows={4}
          label="Prompt"
          placeholder="Who they are, how they think and talk"
          value={$bind(personality, 'prompt')}
        />
        <Button size="sm" variant="filled" className="wedyan-compose-generate">
          <GenerativeIcon />
          <span>Generate</span>
        </Button>
      </GenerationGroup>
      <GenerationGroup label="Settings" card>
        <div className="wedyan-compose-property-row">
          <span>Model</span>
          <Select size="xs" label="Model" options={models} value={$bind(personality, 'model')}>
            <Select.Snippet for="trigger">{(value) => <span>{models[value as string]}</span>}</Select.Snippet>
          </Select>
        </div>
      </GenerationGroup>
      <GenerationGroup label="History">
        <Snippet>
          {() =>
            personality.tries.length ? (
              <Listbox size="xs" label="Tries" value={$bind(personality, 'chosen')}>
                {[...personality.tries].reverse().map((attempt) => (
                  <ListboxOption key={attempt.id} value={attempt.id} className="wedyan-lounge-try">
                    <span className="wedyan-compose-attempt-text">
                      <span>{attempt.prompt}</span>
                      <span>{models[attempt.model] ?? attempt.model}</span>
                      <time dateTime={attempt.created}>
                        {new Date(attempt.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </time>
                    </span>
                  </ListboxOption>
                ))}
              </Listbox>
            ) : (
              <p className="wedyan-compose-property-note">Nothing made yet.</p>
            )
          }
        </Snippet>
      </GenerationGroup>
    </div>
  );
}, 'PersonalityForm');

/**
 * One of the open persona's sides — the head, the body, or the wardrobe: its main picture, large —
 * the picture, an empty still waiting to be made, or an empty place offering to add one — then, once
 * it exists, its others — poses, or outfits — each to pick, make the main one or remove, ending with
 * a tile adding one. What's added is a new, empty still, picked at once so its prompt is beside it.
 */
const LookTab = setup<{ part: Part }>((props) => {
  const session = loungeCtx.get() as LoungeSession;
  const view = personaViewCtx.get() as PersonaView;
  const persona = () => (session.path ? personaAt(session.path) : undefined);
  // Each side gets its own tab, made afresh, so which side it is never changes under it.
  const part = $static(() => PARTS[props.part]);

  const look = (): Side | undefined => persona()?.[props.part];
  const main = () => look()?.main ?? '';
  const picture = () => (main() && session.path ? pictureOf(session.path, main()) : undefined);

  /**
   * Makes a new, empty still for this look, puts it where it belongs, and picks it.
   *
   * @param name - What the still is called.
   * @param place - Puts the still, as the persona writes it, into the persona.
   */
  const add = (name: string, place: (document: PersonaDocument, source: string) => void) => {
    if (!session.path) return;
    const source = newStill(session.path, name, part.aspect);
    changeOpen(session, (document) => place(document, source));
    view.pick(source);
  };

  return () => (
    <div className={CLASS.TAB}>
      <figure className={CLASS.SLOT} data-part={props.part} aria-label={part.main}>
        <Snippet data={() => (main() ? (picture() ?? '') : null)}>
          {(src) => {
            if (src) {
              // The picture picks itself; downloading it floats at its corner, beside, not inside.
              return (
                <div className={CLASS.SLOT_FRAME}>
                  <PictureButton source={main()} label={part.main}>
                    <img src={src} alt="" className={CLASS.SLOT_PICTURE} />
                  </PictureButton>
                  <FloatingDownload src={src} name={`${persona()?.name || 'Unnamed'} ${part.main.toLowerCase()}`} />
                </div>
              );
            }
            if (src === '') {
              // A still not made yet: picked, its prompt beside it is where it's made from.
              return (
                <PictureButton source={main()} label={part.main}>
                  <div className={CLASS.SLOT_PICTURE}>
                    <EmptyState title="Not made yet" description="Write its prompt beside it, then generate." level={3}>
                      <EmptyState.Snippet for="icon">{() => <GenerativeIcon />}</EmptyState.Snippet>
                    </EmptyState>
                  </div>
                </PictureButton>
              );
            }
            return (
              <div className={CLASS.SLOT_PICTURE}>
                <EmptyState title={part.empty} description={part.hint} level={3}>
                  <EmptyState.Snippet for="icon">{() => <PersonIcon />}</EmptyState.Snippet>
                  <EmptyState.Snippet for="action">
                    {() => (
                      <Button size="sm" variant="filled" onClick={() => add(part.main, (document, source) => (lookOf(document, props.part).main = source))}>
                        <AddIcon />
                        <span>{part.add}</span>
                      </Button>
                    )}
                  </EmptyState.Snippet>
                </EmptyState>
              </div>
            );
          }}
        </Snippet>
      </figure>
      <Show when={main}>
        {() => (
          <section className={CLASS.SECTION} aria-label={part.othersLabel}>
            <span className={CLASS.FIELD_LABEL}>{part.othersLabel}</span>
            {tiles(session, {
              items: () => look()?.[part.others] ?? [],
              label: part.other,
              add: { label: part.addOther, run: () => add(part.other, (document, source) => (lookOf(document, props.part)[part.others] ??= []).push(source)) },
              remove: {
                label: part.remove,
                description: part.removeHint,
                run: (source) => changeOpen(session, (document) => removeOther(document, props.part, source)),
              },
              promote: {
                label: part.promote,
                run: (source) => changeOpen(session, (document) => makeMain(document, props.part, source)),
              },
            })}
          </section>
        )}
      </Show>
    </div>
  );
}, 'LookTab');

/**
 * One of the open persona's pictures as something to pick, marked while picked, so how it was made
 * shows beside the persona. A double click opens its still in a Preview window, larger.
 */
const PictureButton = setup<{ source: string; label: string; children?: ReactNode }>((props) => {
  const session = loungeCtx.get() as LoungeSession;
  const view = personaViewCtx.get() as PersonaView;

  // The persona writes its pictures by path from its own file; Preview takes the still's own path.
  const enlarge = () => {
    const still = session.path ? stillAt(session.path, props.source) : undefined;
    if (still) system.preview(still.path);
  };

  return () => (
    <button
      type="button"
      className={CLASS.PICK}
      aria-label={props.label}
      aria-pressed={view.picked === props.source}
      onClick={() => view.pick(props.source)}
      onDoubleClick={enlarge}
    >
      {props.children}
    </button>
  );
}, 'PictureButton');

/**
 * Pictures as a grid of tiles to pick, each with what can be done with it as icons inset at its
 * picture's corners while it's hovered or focused — making it the main picture at the start,
 * removing it at the end — the grid ending with a square tile adding one.
 *
 * @param session - The window's open persona, which the pictures' paths are written from.
 * @param grid - The pictures, read live; what each is, for screen readers; adding one; removing
 *   one; and making one the main picture, where there's one to make.
 * @returns The grid.
 */
function tiles(
  session: LoungeSession,
  grid: {
    items: () => string[];
    label: string;
    add: { label: string; run: () => void };
    remove: { label: string; description: string; run: (source: string) => void };
    promote?: { label: string; run: (source: string) => void };
  }
): ReactNode {
  return (
    <ul className={CLASS.TILES}>
      <For each={grid.items}>
        {(source) => (
          <li className={CLASS.TILE} title={source}>
            <PictureButton source={source} label={grid.label}>
              <Snippet data={() => (session.path ? pictureOf(session.path, source) : undefined)}>
                {(picture) =>
                  picture ? (
                    <img src={picture} alt="" className={CLASS.TILE_PICTURE} />
                  ) : (
                    <span className={CLASS.TILE_PICTURE}>
                      <ImageIcon />
                    </span>
                  )
                }
              </Snippet>
            </PictureButton>
            {grid.promote && (
              <span className={CLASS.TILE_PROMOTE}>
                <Button
                  aria-label={grid.promote.label}
                  size="xs"
                  variant="glass"
                  className={AUI_CLASS.CONTROL_ICON}
                  onClick={() => grid.promote?.run(source)}
                >
                  <PersonIcon />
                  <Tooltip>{grid.promote.label}</Tooltip>
                </Button>
              </span>
            )}
            <span className={CLASS.TILE_REMOVE}>{removeButton(grid.remove, source)}</span>
          </li>
        )}
      </For>
      <li className={CLASS.TILE}>
        <button type="button" className={CLASS.TILE_ADD} onClick={grid.add.run}>
          <AddIcon />
          <span>{grid.add.label}</span>
        </button>
      </li>
    </ul>
  );
}

/**
 * An icon button taking a picture away, once the user confirms.
 *
 * @param remove - What it does, e.g. "Remove pose"; what removing means, said before it's confirmed; and the removal.
 * @param source - The picture, as the persona writes it.
 * @returns The button.
 */
function removeButton(remove: { label: string; description: string; run: (source: string) => void }, source: string): ReactNode {
  return (
    <ConfirmButton
      label={remove.label}
      size="xs"
      variant="glass"
      title={() => `${remove.label}?`}
      description={remove.description}
      action="Remove"
      onconfirm={() => remove.run(source)}
    >
      <CloseIcon />
      <Tooltip>{remove.label}</Tooltip>
    </ConfirmButton>
  );
}

/**
 * Changes the persona open in a Lounge window, while it's still on the drive, and marks when it
 * changed.
 *
 * @param session - The window's open item.
 * @param apply - What to change in it.
 */
function changeOpen(session: LoungeSession, apply: (document: PersonaDocument) => void): void {
  const document = session.path ? personaAt(session.path) : undefined;
  if (document) edit(document, () => apply(document));
}

/**
 * Every picture on one of a persona's sides: its main picture and its others.
 *
 * @param document - The persona.
 * @param part - The head, the body, or the wardrobe.
 * @returns The pictures, as the persona writes them.
 */
function picturesOf(document: PersonaDocument, part: Part): string[] {
  const side: Side | undefined = document[part];
  return side ? [side.main, ...(side[PARTS[part].others] ?? [])].filter(Boolean) : [];
}

/**
 * One of a persona's sides, made empty first when it has none, to be written into.
 *
 * @param document - The persona.
 * @param part - The head, the body, or the wardrobe.
 * @returns The side.
 */
function lookOf(document: PersonaDocument, part: Part): Side {
  if (!document[part]) document[part] = { main: '' };
  return document[part] as Side;
}

/**
 * Makes one of a side's others its main picture; the main picture it replaces takes its place
 * among the others, so nothing is lost.
 *
 * @param document - The persona.
 * @param part - The head, the body, or the wardrobe.
 * @param source - The pose or outfit.
 */
function makeMain(document: PersonaDocument, part: Part, source: string): void {
  const side = lookOf(document, part);
  const key = PARTS[part].others;
  const others = side[key] ?? [];
  others.splice(others.indexOf(source), 1, ...(side.main ? [side.main] : []));
  side.main = source;
  if (!others.length) delete side[key];
}

/**
 * Takes one of a side's others away; they're optional, so with none left they're left out, and so
 * is a body or a wardrobe with no picture at all.
 *
 * @param document - The persona.
 * @param part - The head, the body, or the wardrobe.
 * @param source - The pose or outfit.
 */
function removeOther(document: PersonaDocument, part: Part, source: string): void {
  const side: Side | undefined = document[part];
  const key = PARTS[part].others;
  const others = side?.[key];
  if (!side || !others) return;
  others.splice(others.indexOf(source), 1);
  if (!others.length) delete side[key];
  if (part !== 'head' && !side.main && !side[key]) delete document[part];
}

/**
 * Sets a persona's voice by its name and sample; with neither, it has no voice, as the format keeps
 * the voice optional.
 *
 * @param document - The persona.
 * @param name - What the voice is called.
 * @param sample - The address of a recording of it.
 */
function setVoice(document: PersonaDocument, name: string, sample: string): void {
  if (!name && !sample) return void delete document.voice;
  document.voice = sample ? { name, sample } : { name };
}
