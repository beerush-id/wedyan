import { isBrowser, microtask, mutable, onCleanup, subscribe } from '@irpclib/irpc/core';
import { configure, type FileInput, fileModule, PERSIST_DELAY, read, readStub, write } from '@irpclib/r2-file';
import { workspace } from '@/lib/kernel/workspace.h.js';

// The desktop's files, one live object per file: read once, then kept in sync with every change
// made to it anywhere in the session. Every window and document referring to a file shares it, so
// a change made in one is seen in all of them.

/** How long the browser keeps a read: the tab's life, since the workspace keeps it in sync. */
const A_YEAR = 365 * 24 * 60 * 60 * 1000;

/** The field an item of a list is known by, so it stays the same object when the list changes. */
export const ENTITY_KEY = 'id';

// The browser's reads are kept and owned here, never closed by the window that asked first; the
// server's are made fresh every time.
configure({ maxAge: { read: isBrowser() ? A_YEAR : 0 } });
fileModule.configure(readStub, { controlled: isBrowser() });

/** How a referenced file's content is read: parsed JSON, or plain text. */
export type FileRefEncoding = 'json' | 'text';

/** A reference to a file: its content, the same object wherever it's referred to. */
export type FileRef<T> = {
  /** Whether its content has arrived. */
  readonly ready: boolean;
  /** Its content, changed in place when it changes anywhere; undefined while it doesn't exist. */
  readonly data: T | undefined;
};

/**
 * Refers to a file: read once, then kept in sync with every change made to it in the session, the
 * same object for every caller. Nothing is opened per file; the desktop's one workspace stream
 * says what changed.
 *
 * @param path - The file's home path (`~/…`), the way the workspace reports changes.
 * @param encoding - How its content is read: parsed `json`, or `text`.
 * @returns The file's live reference.
 */
export function fileRef<T>(path: string, encoding: FileRefEncoding = 'json'): FileRef<T> {
  return (KEPT.get(keyOf(path, encoding)) ?? open(path, encoding)).state as FileRef<T>;
}

/**
 * Edits a referenced JSON file: what's changed in its content is saved, and changes made elsewhere
 * wait until the edits are saved, so they never undo them. Stops editing with the lifecycle it's
 * made in.
 *
 * @param path - The file's home path (`~/…`).
 * @returns The file's live reference, the same object `fileRef` gives every other caller.
 */
export function edit<T>(path: string): FileRef<T> {
  const kept = KEPT.get(keyOf(path, 'json')) ?? open(path, 'json');
  kept.editors += 1;
  if (kept.editors === 1) kept.stopSaving = saveChanges(kept);

  onCleanup(() => {
    kept.editors -= 1;
    if (kept.editors) return;
    kept.stopSaving?.();
    kept.stopSaving = undefined;
  });

  return kept.state as FileRef<T>;
}

/**
 * A JSON file being edited on this desktop, as its editors hold it: changes made to it here are
 * saved with theirs. Undefined when nothing here is editing it, or its content hasn't arrived.
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
  /** How many editors have it open; it's saved while there's one. */
  editors: number;
  /** Changed here and not saved yet: changes from elsewhere wait. */
  dirty: boolean;
  /** Taking a change from elsewhere, which isn't saved back. */
  syncing: boolean;
  stopSaving?: () => void;
};

/** The files this desktop keeps, by encoding and path; the browser's only. */
const KEPT = new Map<string, Kept>();

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
    dirty: false,
    syncing: false,
  };
  // Kept for the tab only: on the server every request is someone else's.
  if (isBrowser()) KEPT.set(keyOf(path, encoding), kept);
  void refresh(kept);
  return kept;
}

/** Opens the workspace stream once, and keeps every kept file in step with what it reports. */
function listen(): void {
  if (channel || !isBrowser()) return;
  const stream = workspace();
  channel = stream;

  stream.answer('changed', (path) => {
    for (const kept of KEPT.values()) if (kept.path === path) void refresh(kept, true);
    return true;
  });

  // Connected again: what changed while it was away is read again.
  let connected = 0;
  stream.subscribe(() => {
    const since = stream.data.connected;
    if (!since || since === connected) return;
    if (connected) for (const kept of KEPT.values()) void refresh(kept, true);
    connected = since;
  });
}

/** Reads a kept file and puts its content into what's kept, in place. */
async function refresh(kept: Kept, fresh = false): Promise<void> {
  const options = { encoding: kept.encoding } as const;
  if (fresh) fileModule.invalidate(readStub, kept.path, options);
  const content = await read(kept.path, options as never);
  // Edited here since: the edits win until they're saved, and their save is what's kept.
  if (kept.dirty) return;

  kept.syncing = true;
  const merged = merge(kept.state.data, content);
  if (merged !== kept.state.data) kept.state.data = merged;
  kept.state.ready = true;
  kept.syncing = false;
}

/** Saves a kept file's changes a moment after they stop; returns what stops it, saving what's left. */
function saveChanges(kept: Kept): () => void {
  const [schedule, cancel] = microtask(PERSIST_DELAY);
  let version = 0;
  let pending: (() => void) | undefined;

  const unsubscribe = subscribe(kept.state, (snap, change) => {
    if (change.type === 'init' || kept.syncing || !kept.state.ready) return;
    kept.dirty = true;
    const mine = ++version;
    pending = () => {
      pending = undefined;
      void write(kept.path, (snap as Kept['state']).data as FileInput).then(() => {
        if (mine === version) kept.dirty = false;
      });
    };
    schedule(() => pending?.());
  });

  return () => {
    unsubscribe();
    cancel();
    pending?.();
  };
}

/**
 * Puts `next` into `current` in place, keeping every object and array that's still there, so
 * whoever holds one sees the change: list items are matched by `ENTITY_KEY`, else by position.
 *
 * @returns What to keep: `current` changed in place, or `next` when they aren't the same kind.
 */
function merge(current: unknown, next: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(next)) {
    const known = new Map(current.filter(isEntity).map((item) => [item[ENTITY_KEY], item]));
    const merged = next.map((item, index) =>
      merge(isEntity(item) ? known.get(item[ENTITY_KEY]) : current[index], item),
    );
    merged.forEach((item, index) => {
      if (current[index] !== item) current[index] = item;
    });
    if (current.length > merged.length) current.splice(merged.length);
    return current;
  }

  if (isRecord(current) && isRecord(next)) {
    for (const key of Object.keys(current)) if (!(key in next)) delete current[key];
    for (const [key, value] of Object.entries(next)) {
      const merged = merge(current[key], value);
      if (current[key] !== merged) current[key] = merged;
    }
    return current;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntity(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value[ENTITY_KEY] !== undefined;
}
