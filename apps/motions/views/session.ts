import { splitSegment } from '@airlib/aria';
import { createContext, mutable } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import { documentAt, follow } from '@/lib/documents/store.js';
import type { StillDocument, TakeDocument } from '@/lib/documents/types.js';
import type { MotionsRoute } from './route.js';

/**
 * What one Motions window is working on, shared between the window and its dock: the stage open
 * for editing — its path, its timeline — and the clips picked on it, by id.
 */
export type MotionsSession = {
  /** Where the window is, which its dock follows: the library, Direct and what's picked there, or Compose. */
  route?: MotionsRoute;
  stage?: string;
  timeline?: Timeline;
  clips: string[];
  /** Opens a document, by path, in the window's own view for it. */
  open?: (path: string) => void;
  /** Renders the open stage to a video, while one is open and not already rendering. */
  render?: () => void;
  /** What the open stage's render says now: that it can't render here, how far it is, or what it made. */
  status: string;
  rendering: boolean;
  /** Whether dragging on the timeline snaps clips and the playhead to what's near. */
  snap: boolean;
};

/** A generated image or video, by path: what its generation is made again from. */
export type GenerativeSource = {
  path: string;
  source: StillDocument | TakeDocument;
};

/** A clip made from a generated image or video, and the document it was generated as. */
export type GenerativeClip = GenerativeSource & {
  segment: TimelineSegment;
};

/** The session of the window a view is in, set by the window for everything inside it. */
export const sessionCtx = createContext<MotionsSession>();

/** Each open window's session, by the window's id. */
const SESSIONS = new Map<string, MotionsSession>();

/**
 * A window's session, made the first time it's asked for.
 *
 * @param id - The window's id.
 * @returns The session, shared by everything working on that window.
 */
export function sessionOf(id: string): MotionsSession {
  let session = SESSIONS.get(id);
  if (!session) {
    session = mutable<MotionsSession>({ clips: [], status: '', rendering: false, snap: false }, { recursive: false });
    SESSIONS.set(id, session);
  }
  return session;
}

/**
 * Cuts the clips picked in a session in two at the playhead, as Cmd or Ctrl and B does on the
 * timeline: each one the playhead is inside of, unless its track is locked.
 *
 * @param session - The window's session.
 */
export function splitPicked(session: MotionsSession): void {
  const { timeline, clips } = session;
  if (!timeline) return;
  const frame = timeline.state.frame;
  for (const track of timeline.tracks) {
    if (track.meta?.locked) continue;
    for (const segment of [...track.segments]) if (clips.includes(segment.id)) splitSegment(segment, frame);
  }
}

/**
 * Lets go of a window's session once the window closes.
 *
 * @param id - The window's id.
 */
export function endSession(id: string): void {
  SESSIONS.delete(id);
}

/**
 * The clip picked in a session, when it is the only one.
 *
 * @param session - The window's session.
 * @returns The clip's segment, or nothing unless one clip, alone, is picked.
 */
export function pickedClip(session: MotionsSession): TimelineSegment | undefined {
  const { timeline, clips } = session;
  if (!timeline || clips.length !== 1) return;

  for (const track of timeline.tracks) {
    for (const segment of track.segments) if (segment.id === clips[0]) return segment;
  }
}

/**
 * The clip picked in a session, when it is the only one and was made from a generated image or
 * video: its segment names the `.still` or `.take` it shows in `meta.source`, by path from the stage.
 *
 * @param session - The window's session.
 * @returns The clip and its source, or nothing unless one generative clip, alone, is picked.
 */
export function generativeClip(session: MotionsSession): GenerativeClip | undefined {
  const segment = pickedClip(session);
  const source = segment?.meta?.source;
  if (!segment || !session.stage || typeof source !== 'string') return;

  const found = follow<'still' | 'take'>(session.stage, source);
  return found.document ? { segment, path: found.path, source: found.document as StillDocument | TakeDocument } : undefined;
}

/**
 * Whether the row picked in Direct is writing — the script, or a memo — which a prompt then writes.
 *
 * @param session - The window's session.
 * @returns Whether Direct shows writing.
 */
export function writingPicked(session: MotionsSession): boolean {
  const { route } = session;
  if (route?.view !== 'motion' || !route.item) return false;
  return route.item.endsWith('.md') || documentAt(route.item)?.type === 'memo';
}

/**
 * The row picked in Direct, when it's a generated image or video.
 *
 * @param session - The window's session.
 * @returns The generated document and its path, or nothing unless Direct shows one.
 */
export function generativePick(session: MotionsSession): GenerativeSource | undefined {
  const { route } = session;
  if (route?.view !== 'motion' || !route.item) return;
  const document = documentAt(route.item);
  return document?.type === 'still' || document?.type === 'take' ? { path: route.item, source: document } : undefined;
}
