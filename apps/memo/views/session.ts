import { createContext } from '@airlib/react';
import type { MemoDocument } from '@/lib/documents/types.js';

/** The memo open beside the list: what Memo's window shares with its editor. */
export type MemoSession = {
  /** The open memo's path; none while the tab has no memo. */
  readonly path: string | null;
  /** Takes the open memo off the drive; the tab's first opens in its place. */
  remove(): void;
  /** Tells the list what's changed in the memo at a path. */
  changed(path: string, document: MemoDocument): void;
};

/** The memo open in Memo's window, which its editor works on. */
export const memoCtx = createContext<MemoSession>();
