import type { TimelineSnapshot } from '@airlib/react/timeline';

/** Every kind of document Wedyan works with, by its file extension. */
export type DocumentType = 'motion' | 'stage' | 'still' | 'take' | 'chat' | 'memo' | 'persona';

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
  /** When it was made and last changed, as ISO dates. */
  created: string;
  updated: string;
  author: DocumentAuthor;
  tags?: string[];
};

/**
 * A video project, from the ask it started with to the video it becomes: the brief, the script,
 * its stages in order, the assets they use, and the chats and memos around it. Its stages play in
 * order as one video.
 */
export type MotionDocument = DocumentHeader<'motion'> & {
  /** The ask in the words it was made with, e.g. "a 30s video to promote Wedyan for the hack". */
  brief: string;
  aspect: string;
  cover: string;
  /** How long it is meant to run, in seconds. */
  length?: number;
  status: 'draft' | 'rendered';
  script: ScriptScene[];
  /** Its stages in playing order, by path from this file. */
  stages: string[];
  assets: MotionAsset[];
  /** The chats and memos about it, by path from this file. */
  chats?: string[];
  memos?: string[];
};

/** One scene of a project's script: what it says and shows, how long it runs, and the stage that realizes it. */
export type ScriptScene = {
  id: string;
  title: string;
  /** What's said over it. */
  narration?: string;
  /** What's written on screen. */
  onScreen?: string;
  /** What it should look like, for whoever makes it. */
  visual?: string;
  seconds: number;
  /** The stage that realizes it, by path from the project. */
  stage?: string;
};

/** Something a project's stages use: media by address, or a generated image or video by path. */
export type MotionAsset = {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'still' | 'take';
  src: string;
};

/**
 * One playable composition: a timeline whose tracks hold clips (its segments). The
 * composition's own `props` are the stage's size and backdrop.
 */
export type StageDocument = DocumentHeader<'stage'> & {
  /** The script scene it realizes, by id. */
  scene?: string;
  /** Who appears or speaks in it, by path from this file to each `.persona`. */
  casts?: string[];
  composition: TimelineSnapshot & { props: { width: number; height: number; background?: string } };
};

/**
 * Someone or something that appears or speaks — a person, a character, a mascot, an agent — the
 * same file wherever they appear: a film's character, a promo's narrator, a contact.
 */
export type PersonaDocument = DocumentHeader<'persona'> & {
  description?: string;
  kind: 'person' | 'character' | 'mascot' | 'agent';
  /** Reference looks, by `.still` path or image address; the first is their portrait. */
  looks: string[];
  voice?: { name: string; sample?: string };
  /** Anything longer about them, by path to a Markdown file. */
  notes?: string;
};

/** One generated image as an editable source: how it was asked for, every attempt, its edits, and the one chosen. */
export type StillDocument = DocumentHeader<'still'> & {
  prompt: string;
  /** Images it was made from, by address or path. */
  references: string[];
  attempts: GeneratedAttempt[];
  /** Edits made to the chosen attempt, in order, e.g. a masked region painted over. */
  edits: StillEdit[];
  /** The attempt it shows, by id. */
  chosen: string;
};

/** One generated video as an editable source, like a still: how it was asked for, every attempt, and the one chosen. */
export type TakeDocument = DocumentHeader<'take'> & {
  prompt: string;
  references: string[];
  attempts: (GeneratedAttempt & { poster?: string; seconds: number })[];
  chosen: string;
};

/** One try at a generation: its result, and what it was asked with when that differs from the document's prompt. */
export type GeneratedAttempt = { id: string; src: string; prompt?: string; created: string };

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

/** Any Wedyan document. */
export type WedyanDocument =
  | MotionDocument
  | StageDocument
  | StillDocument
  | TakeDocument
  | ChatDocument
  | MemoDocument
  | PersonaDocument;

/** A document of one type. */
export type DocumentOf<T extends DocumentType> = Extract<WedyanDocument, { type: T }>;
