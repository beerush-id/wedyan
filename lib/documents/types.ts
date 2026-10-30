import type { TimelineSnapshot } from '@airlib/react/timeline';

/** Every kind of document Wedyan works with, by its file extension. */
export type DocumentType = 'motion' | 'stage' | 'still' | 'take' | 'sound' | 'chat' | 'memo' | 'persona' | 'album';

/** Who made a document: a person, or an agent — and then the ask it acted on. */
export type DocumentAuthor = { kind: 'user' } | { kind: 'agent'; ask?: string };

/**
 * What every document starts with, whatever its type, so any part of Wedyan — a view, the prompt's
 * `@` mentions, an agent — can read any document the same way.
 */
export type DocumentHeader<T extends DocumentType = DocumentType> = {
  type: T;
  /** The shape this document's content follows, so older documents can be read as the shape changes. */
  version: 1;
  id: string;
  name: string;
  /** What it is, in a line, under 256 characters; anything longer is a Markdown file it points to. */
  description?: string;
  /** When it was made and last changed, as ISO dates. */
  created: string;
  updated: string;
  author: DocumentAuthor;
  /** The agent it's assigned to, by path from this file to its `.agent`: who may work on it. */
  assignee?: string;
  tags?: string[];
};

/**
 * A video project, from the ask it started with to the video it becomes: its script, its stages
 * in order, the assets they use, and the chats and memos around it. Its stages play in order as
 * one video. The ask it was made from is its author's.
 */
export type MotionDocument = DocumentHeader<'motion'> & {
  aspect: string;
  cover: string;
  /** How long it is meant to run, in seconds. */
  length?: number;
  status: 'draft' | 'rendered';
  /** The `.album` it's kept in, by path from this file; without one, it's among the unsorted. */
  album?: string;
  /** Its script, with the versions before it and how an agent wrote it. */
  script?: MotionScript;
  /** Its stages in playing order, by path from this file. */
  stages: string[];
  assets: MotionAsset[];
  /** The chats and memos about it, by path from this file. */
  chats?: string[];
  memos?: string[];
};

/** A project's script: the version it is now, the versions kept before it, and how an agent wrote it. */
export type MotionScript = {
  /** The script now, by path from the project to a Markdown file: one `##` heading per scene. */
  path: string;
  /** Versions kept before this one, newest first, each its own Markdown file. */
  revisions?: ScriptRevision[];
  /** What an agent was asked about the script, oldest first, and what each ask made. */
  histories?: ScriptHistory[];
};

/** One earlier version of a script, kept as it was. */
export type ScriptRevision = {
  id: string;
  /** The version, by path from the project to a Markdown file. */
  path: string;
  /** What changed in it, in a line. */
  note?: string;
  author: DocumentAuthor;
  created: string;
};

/** One ask to an agent about a script: the words, how it was answered, and what it made. */
export type ScriptHistory = {
  id: string;
  ask: string;
  /** The model and the reasoning effort it was answered with. */
  model?: string;
  effort?: string;
  /** The version it made, by revision id; none when it made the script as it is now. */
  revision?: string;
  created: string;
};

/** Something a project's stages use: media by address, or a generated image, video or sound by path. */
export type MotionAsset = {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'still' | 'take' | 'sound';
  src: string;
};

/**
 * One playable composition: a timeline whose tracks hold clips (its segments). The
 * composition's own `props` are the stage's size and backdrop.
 */
export type StageDocument = DocumentHeader<'stage'> & {
  /** Its part of the script, by path from this file: `Script.md`, or one scene as `Script.md#heading`. */
  script?: string;
  /** Who appears or speaks in it, by path from this file to each `.persona`. */
  casts?: string[];
  composition: TimelineSnapshot & { props: { width: number; height: number; background?: string } };
};

/**
 * One side of how a persona looks: its main picture, and its other poses — expressions, angles —
 * each a `.still` path. An outside image is never one; it's only a reference a still is made from.
 */
export type PersonaLook = { main: string; poses?: string[] };

/** The outfits a persona can wear: the one they wear unless told otherwise, and the others, each a `.still` path. */
export type PersonaWardrobe = { main: string; outfits?: string[] };

/**
 * Someone or something that appears or speaks — a person, a character, a mascot — the same file
 * wherever they appear: a film's character, a promo's narrator, a contact. An agent is never one:
 * it's an `.agent` of its own.
 */
export type PersonaDocument = DocumentHeader<'persona'> & {
  kind: 'person' | 'character' | 'mascot';
  /** Their face: the main one, which close-ups are made from and which is their portrait, and its poses. */
  head: PersonaLook;
  /** Their whole figure, for full shots, and its poses. */
  body?: PersonaLook;
  /** The outfits they can wear: their default one, and the others. */
  wardrobe?: PersonaWardrobe;
  /** Whether casting them takes their defaults along as references — the main face, figure and outfit — without picking them. */
  attachDefault?: boolean;
  voice?: { name: string; sample?: string };
  /** Anything longer about them, by path to a Markdown file. */
  notes?: string;
};

/**
 * How a generation is asked for, beside its prompt: the model, the picture's aspect ratio, how
 * long a video or a sound runs, in seconds, and how many attempts an image is made in at a time.
 * Kept on the document, so it's made again the same way.
 */
/** How a generation is asked: its model, a picture's aspect ratio, how long a video or a sound runs, and how many it makes in one request. */
export type GenerationSettings = { model?: string; aspect?: string; seconds?: number; batch?: number };

/** One generated image as an editable source: how it was asked for, every attempt, its edits, and the one chosen. */
export type StillDocument = DocumentHeader<'still'> & {
  prompt: string;
  /** How it is made again: the model, the aspect ratio, and how many images one request makes. */
  settings?: Pick<GenerationSettings, 'model' | 'aspect' | 'batch'>;
  /** Images it was made from, by address or path. */
  references: string[];
  /** Who appears in it, by path to each `.persona`. */
  casts?: string[];
  attempts: GeneratedAttempt[];
  /** Edits made to the chosen attempt, in order, e.g. a masked region painted over. */
  edits: StillEdit[];
  /** The attempt it shows, by id. */
  chosen: string;
};

/** One generated video as an editable source, like a still: how it was asked for, every attempt, and the one chosen. */
export type TakeDocument = DocumentHeader<'take'> & {
  prompt: string;
  settings?: GenerationSettings;
  references: string[];
  /** Who appears in it, by path to each `.persona`. */
  casts?: string[];
  attempts: (GeneratedAttempt & { poster?: string; seconds: number })[];
  chosen: string;
};

/**
 * One generated sound as an editable source, like a take without a poster: music, speech, a sound
 * effect, an ambience. Speech also has the words it says and who says them. Every attempt runs
 * for its own seconds.
 */
export type SoundDocument = DocumentHeader<'sound'> & {
  kind: 'music' | 'speech' | 'sfx' | 'ambience';
  /** How it sounds; for speech, how the words are said. */
  prompt: string;
  settings?: Pick<GenerationSettings, 'model' | 'seconds'>;
  /** Sounds it was made from, by address or path. */
  references?: string[];
  /** For speech: the words it says. */
  text?: string;
  /** For speech: who says them, by path to a `.persona`, read for its voice. */
  voice?: string;
  attempts: (GeneratedAttempt & { seconds: number })[];
  chosen: string;
};

/** A generated image, video or sound: what the prompt view edits and makes again. */
export type GenerativeDocument = StillDocument | TakeDocument | SoundDocument;

/** One try at a generation: its result, and the prompt and settings it was made with, to make it again from. */
export type GeneratedAttempt = { id: string; src: string; prompt: string; settings: Omit<GenerationSettings, 'batch'>; created: string };

/** One edit to a still's picture. */
export type StillEdit = {
  id: string;
  kind: 'mask' | 'inpaint' | 'outpaint' | 'upscale';
  /** What it was asked to do, for an inpaint or outpaint. */
  prompt?: string;
  /** The region it applied to, e.g. a mask's address. */
  mask?: string;
  result: string;
  created: string;
};

/** A conversation kept as a work document: its messages, each made of parts. */
export type ChatDocument = DocumentHeader<'chat'> & {
  messages: ChatMessage[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  parts: ({ kind: 'text'; text: string } | { kind: 'attachment'; path: string; name?: string })[];
  created: string;
};

/** Something remembered: a note, a preference, a person, a project, or a fact, in Markdown. */
export type MemoDocument = DocumentHeader<'memo'> & {
  kind: 'note' | 'preference' | 'person' | 'project' | 'fact';
  body: string;
  pinned?: boolean;
  /** When to bring it back up, as an ISO date. */
  remind?: string;
};

/**
 * Projects kept together under a name and a line about them. The projects say which album they're
 * in; the album only names itself.
 */
export type AlbumDocument = DocumentHeader<'album'> & {
  /** Its picture; without one, the cover of its newest project shows. */
  cover?: string;
};

/** Any Wedyan document. */
export type WedyanDocument =
  | MotionDocument
  | StageDocument
  | StillDocument
  | TakeDocument
  | SoundDocument
  | ChatDocument
  | MemoDocument
  | PersonaDocument
  | AlbumDocument;

/** A document of one type. */
export type DocumentOf<T extends DocumentType> = Extract<WedyanDocument, { type: T }>;
