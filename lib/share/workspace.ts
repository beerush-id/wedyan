import { isBrowser, mutable, onCleanup, replay, type StateChange, subscribe } from '@irpclib/irpc/core';
import { configure, read } from '@irpclib/r2-file';
import { merge } from '@/lib/documents/merge.js';
import { type FileEncoding, workspace } from '@/lib/kernel/workspace.h.js';

// The desktop's files, one live object per file. The session's room holds each one: a desktop sends
// the changes made to it here and replays the changes made elsewhere. Every window and document
// referring to a file shares the object, so a change made in one is seen in all of them.

// What's read is read once, for that moment: what stays is held in a room.
configure({ maxAge: { read: 0 } });

/** How a referenced file's content is read: parsed JSON, or plain text. */
export type FileRefEncoding = FileEncoding;

/** A reference to a file: its content, the same object wherever it's referred to. */
export type FileRef<T> = {
  /** Whether its content has arrived. */
  readonly ready: boolean;
  /** Its content, changed in place when it changes anywhere; undefined while it doesn't exist. */
  readonly data: T | undefined;
};

/**
 * Refers to a file: its content, kept in step with every change made to it in the session, the same
 * object for every caller. Nothing is opened per file: it goes through the desktop's one stream.
 *
 * @param path - The file's home path (`~/…`).
 * @param encoding - How its content is read: parsed `json`, or `text`.
 * @returns The file's live reference.
 */
export function fileRef<T>(path: string, encoding: FileRefEncoding = 'json'): FileRef<T> {
  return (KEPT.get(keyOf(path, encoding)) ?? open(path, encoding)).state as FileRef<T>;
}

/** A write to a file from outside what's held, like an agent's; or its removal. */
export type FileChange = { path: string; removed: boolean };

/**
 * Hears every write in a folder that didn't come through a held file, so what a window lists can
 * learn of what it doesn't hold. Stops with the lifecycle it's made in.
 *
 * @param folder - The folder's home path (`~/…`).
 * @param listener - Told of each change in it.
 */
export function watchFolder(folder: string, listener: (change: FileChange) => void): void {
  listen();
  const watcher = (change: FileChange) => {
    if (change.path.startsWith(`${folder}/`)) listener(change);
  };
  WATCHERS.add(watcher);
  onCleanup(() => WATCHERS.delete(watcher));
}

/**
 * Edits a referenced file: each change made to its content goes to the session's room as it's made.
 * Stops editing with the lifecycle it's made in.
 *
 * @param path - The file's home path (`~/…`).
 * @param blank - What to edit while the file doesn't exist: the file is made by the first change,
 *   not by opening it, so a file whose absence means something keeps meaning it.
 * @param encoding - How its content is held: parsed `json`, or `text`.
 * @returns The file's live reference, the same object `fileRef` gives every other caller.
 */
export function edit<T>(path: string, blank?: T, encoding: FileRefEncoding = 'json'): FileRef<T> {
  const kept = KEPT.get(keyOf(path, encoding)) ?? open(path, encoding);
  const firstBlank = kept.blank === undefined && blank !== undefined;
  kept.blank ??= blank;
  // Already there, and known to be missing, before anyone gave it a blank.
  if (kept.absent && firstBlank) {
    take(kept, () => {
      kept.state.data = kept.blank;
    });
  }
  kept.editors += 1;
  if (kept.editors === 1) kept.stopEmitting = emitChanges(kept);

  onCleanup(() => {
    kept.editors -= 1;
    if (kept.editors) return;
    kept.stopEmitting?.();
    kept.stopEmitting = undefined;
  });

  return kept.state as FileRef<T>;
}

/**
 * A JSON file being edited on this desktop, as its editors hold it: changes made to it here go out
 * with theirs. Undefined when nothing here is editing it, or its content hasn't arrived.
 *
 * @param path - The file's home path (`~/…`).
 * @returns Its live content.
 */
export function edited<T>(path: string): T | undefined {
  const kept = KEPT.get(keyOf(path, 'json'));
  return kept?.editors && kept.state.ready ? (kept.state.data as T) : undefined;
}

/** A file the desktop keeps, and what's editing it. */
type Kept = {
  path: string;
  encoding: FileRefEncoding;
  state: { ready: boolean; data: unknown };
  /** How many editors have it open; its changes go out while there's one. */
  editors: number;
  /** Taking a change from elsewhere, which doesn't go back out. */
  syncing: boolean;
  /** Not in the session yet: its first change sends it whole, which makes the file. */
  absent?: boolean;
  /** What its editors work on while the file doesn't exist. */
  blank?: unknown;
  stopEmitting?: () => void;
};

/** The files this desktop keeps, by encoding and path; the browser's only. */
const KEPT = new Map<string, Kept>();

/** What's watching the session's changes. */
const WATCHERS = new Set<(change: FileChange) => void>();

/** This desktop's workspace stream: one for every file it keeps. */
let channel: ReturnType<typeof workspace> | undefined;

function keyOf(path: string, encoding: FileRefEncoding): string {
  return `${encoding}:${path}`;
}

function open(path: string, encoding: FileRefEncoding): Kept {
  listen();
  const kept: Kept = {
    path,
    encoding,
    state: mutable({ ready: false, data: undefined as unknown }),
    editors: 0,
    syncing: false,
  };

  // On the server every request is someone else's: it reads, and holds nothing.
  if (isBrowser()) {
    KEPT.set(keyOf(path, encoding), kept);
    join(kept);
  } else {
    void read(path, { encoding } as never).then((content) => arrived(kept, content));
  }
  return kept;
}

/** Opens a kept file in the session, and takes what the session holds. */
function join(kept: Kept): void {
  void channel?.ask('open', kept.path, kept.encoding).then(
    (content) => arrived(kept, content),
    (error: Error) => console.error(error),
  );
}

/** Puts a file's content into what's kept, in place. */
function arrived(kept: Kept, content: unknown): void {
  const next = content ?? kept.blank;
  kept.absent = content === null || content === undefined;
  take(kept, () => {
    const merged = merge(kept.state.data, next ?? undefined);
    if (merged !== kept.state.data) kept.state.data = merged;
    kept.state.ready = true;
  });
}

/** Changes what's kept with what came from elsewhere, which doesn't go back out. */
function take(kept: Kept, change: () => void): void {
  kept.syncing = true;
  change();
  kept.syncing = false;
}

/** Opens the workspace stream once, and replays onto what's kept the changes made elsewhere. */
function listen(): void {
  if (channel || !isBrowser()) return;
  const stream = workspace();
  channel = stream;

  stream.answer('replay', (path, encoding, event) => {
    const kept = KEPT.get(keyOf(path, encoding));
    if (kept) {
      take(kept, () => replay(kept.state, event as StateChange));
      kept.absent = kept.state.data === undefined;
    }
    return true;
  });

  stream.answer('changed', (path, removed) => {
    for (const watcher of WATCHERS) watcher({ path, removed: Boolean(removed) });
    return true;
  });

  // Connected again: a new connection holds nothing yet, so what's kept is opened again.
  let connected = 0;
  // Subscribing reads the stream at once, so it's left out of whatever window asked first.
  queueMicrotask(() =>
    stream.subscribe(() => {
      const since = stream.data.connected;
      if (!since || since === connected) return;
      if (connected) for (const kept of KEPT.values()) join(kept);
      connected = since;
    }),
  );
}

/** Sends each change made to a kept file as it's made; returns what stops it. */
function emitChanges(kept: Kept): () => void {
  return subscribe(kept.state, (snap, change) => {
    if (change.type === 'init' || kept.syncing || !kept.state.ready || change.keys[0] !== 'data') return;
    const { absent } = kept;
    kept.absent = false;
    const event = absent
      ? { ...change, keys: ['data'], value: (snap as Kept['state']).data, prev: undefined, type: 'set' }
      : { ...change, prev: undefined };
    void channel?.ask('change', kept.path, kept.encoding, event);
  });
}
