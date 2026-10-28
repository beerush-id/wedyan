import { createContext, mutable } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import { follow } from '@/lib/documents/store.js';
import type { StillDocument, TakeDocument } from '@/lib/documents/types.js';

/**
 * What one Motions window is working on, shared between the window and its dock: the stage open
 * for editing — its path, its timeline — and the clips picked on it, by id.
 */
export type MotionsSession = {
  stage?: string;
  timeline?: Timeline;
  clips: string[];
  /** Opens a document, by path, in the window's own view for it. */
  open?: (path: string) => void;
  /** Renders the open stage to a video, while one is open and not already rendering. */
  render?: () => void;
  /** Saves the last render again, once there is one. */
  download?: () => void;
  /** What the open stage's render says now: that it can't render here, how far it is, or what it made. */
  status: string;
  rendering: boolean;
  /** Whether dragging on the timeline snaps clips and the playhead to what's near. */
  snap: boolean;
};

/** A clip made from a generated image or video, and the document it was generated as. */
export type GenerativeClip = {
  segment: TimelineSegment;
  path: string;
  source: StillDocument | TakeDocument;
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
    session = mutable<MotionsSession>({ clips: [], status: '', rendering: false, snap: true }, { recursive: false });
    SESSIONS.set(id, session);
  }
  return session;
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
 * The clip picked in a session, when it is the only one and was made from a generated image or
 * video: its segment names the `.still` or `.take` it shows in `meta.source`, by path from the stage.
 *
 * @param session - The window's session.
 * @returns The clip and its source, or nothing unless one generative clip, alone, is picked.
 */
export function generativeClip(session: MotionsSession): GenerativeClip | undefined {
  const { timeline, stage, clips } = session;
  const clip = clips.length === 1 ? clips[0] : undefined;
  if (!timeline || !stage || !clip) return;

  for (const track of timeline.tracks) {
    for (const segment of track.segments) {
      if (segment.id !== clip) continue;
      const source = segment.meta?.source;
      if (typeof source !== 'string') return;
      const found = follow<'still' | 'take'>(stage, source);
      return found.document ? { segment, path: found.path, source: found.document as StillDocument | TakeDocument } : undefined;
    }
  }
}
