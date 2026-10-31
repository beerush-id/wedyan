import {
  type AnyType,
  createContextStore,
  IRPC_STORE,
  type RoomSetup,
  SESSION_STORE,
  stream,
  withContext,
} from '@irpclib/irpc';
import {
  getContext,
  microtask,
  mutable,
  replay,
  shortId,
  snapshot,
  type StateChange,
  subscribe,
} from '@irpclib/irpc/core';
import { fileModule, read, readStub, write } from '@irpclib/r2-file';
import type { FileDriver } from '@irpclib/r2-file/adapter';
import { fsContext } from '@irpclib/r2-file/context';
import { merge } from '@/lib/documents/merge.js';
import { detachedContext } from './chat.js';
import { kernel } from './package.js';
import {
  type FileEncoding,
  lounge,
  type LoungeMessage,
  workspace,
  type WorkspaceQueries,
  type WorkspaceState,
} from './workspace.h.js';

/** The session topic every write to the session's files goes out on, by its home path. */
const FILE_CHANGED = 'workspace.changed';
const LOUNGE_MESSAGE = 'lounge.message';

/** How long, in ms, a held file's changes rest before it's written, so typing is one write. */
const SAVE_DELAY = 1000;

/** Set while a held file is written: what it writes, the session already holds. */
const AT_REST = Symbol('workspace.at-rest');

/** Who hears a held file's change: one desktop, passing it on to be replayed. */
type Listener = (event: StateChange) => void;

/** A change as it goes out: which file, and whether it's gone. */
type FileChange = { path: string; removed: boolean };

kernel.construct(lounge, () =>
  stream((state) => {
    state.data = { id: shortId(), connected: Date.now() };
    const member = SESSION_STORE.join<LoungeMessage>(LOUNGE_MESSAGE, (msg) => {
      if ((msg as AnyType).sender === state.data.id) return;
      void state.ask('message', msg);
    });
    void state.answer('message', (e) => {
      SESSION_STORE.broadcast(LOUNGE_MESSAGE, { ...e, sender: state.data.id });
      return true;
    });

    return () => member.leave();
  }),
);

kernel.construct(workspace, () =>
  stream<WorkspaceState, WorkspaceQueries>(
    (state) => {
      const id = shortId();
      const held = new Map<string, ReturnType<typeof fileRoom>>();
      const member = SESSION_STORE.join<FileChange>(FILE_CHANGED, ({ path, removed }) => {
        void state.ask('changed', path, removed);
      });

      state.answer('open', (path, encoding) => {
        const key = keyOf(path, encoding);
        const room = held.get(key) ?? fileRoom(path, encoding);
        held.set(key, room);
        return room.ask('join', id, (event) => void state.ask('replay', path, encoding, event));
      });
      state.answer('change', (path, encoding, event) => {
        return held.get(keyOf(path, encoding))?.ask('change', event, id) ?? false;
      });

      state.data = { connected: Date.now() };
      return () => {
        member.leave();
        for (const room of held.values()) {
          room.ask('leave', id);
          room.leave();
        }
      };
    },
    { connected: 0 },
  ),
);

/**
 * Joins the session's room for a file, which holds its content for every desktop: a desktop's
 * change is replayed onto it and goes to the others, and the file is written once the changes rest.
 *
 * @param path - The file's home path (`~/…`).
 * @param encoding - How its content is held.
 * @returns The membership.
 */
function fileRoom(path: string, encoding: FileEncoding) {
  return SESSION_STORE.room(`file:${keyOf(path, encoding)}`, ({ hold }: RoomSetup) => {
    const state = mutable<{ data: unknown }>({ data: undefined });
    const options = { encoding };
    const home = fsContext.get();
    const context = detachedContext();
    const listeners = new Map<string, Listener>();
    const failed = (error: Error) => IRPC_STORE.error(error, [{ file: path }]);
    const [schedule] = microtask(SAVE_DELAY);

    // Always into the home it was opened in, whoever's call it outlives.
    const inHome = <T>(task: () => Promise<T>, store = context) =>
      withContext(store, () => {
        if (home) fsContext.set(home);
        return task();
      });
    const atRest = createContextStore<string | symbol, unknown>([...context.entries(), [AT_REST, true]]);

    // Taking what's in the file, which needs no writing back.
    let reading = false;
    const load = () =>
      inHome(async () => {
        fileModule.invalidate(readStub, path, options as never);
        const content = await read(path, options as never);
        reading = true;
        const merged = merge(state.data, content ?? undefined);
        if (merged !== state.data) state.data = merged;
        reading = false;
      });

    // Keeps the room open until what's held is written.
    let written: (() => void) | undefined;
    const save = () => {
      const done = written;
      written = undefined;
      inHome(() => write(path, snapshot(state).data as never), atRest)
        .catch(failed)
        .finally(done);
    };

    let emitter: string | undefined;
    const stop = subscribe(state, (_, event) => {
      if (event.type === 'init') return;
      for (const [id, listener] of listeners) if (id !== emitter) listener({ ...event, prev: undefined });
      if (reading) return;
      if (!written) {
        void hold(
          new Promise<void>((resolve) => {
            written = resolve;
          }),
        );
      }
      schedule(save);
    });

    const loaded = hold(load());
    loaded.catch(failed);
    const heard = SESSION_STORE.join(writtenTopic(path), () => {
      hold(load()).catch(failed);
    });

    return {
      data: state,
      commands: {
        join: (id: string, listener: Listener) =>
          loaded.then(() => {
            listeners.set(id, listener);
            return snapshot(state).data ?? null;
          }),
        change: (event: StateChange, id: string) => {
          emitter = id;
          replay(state, { ...event, prev: undefined });
          emitter = undefined;
          return true;
        },
        leave: (id: string) => listeners.delete(id),
      },
      close: () => {
        stop();
        heard.leave();
      },
    };
  });
}

function keyOf(path: string, encoding: FileEncoding): string {
  return `${encoding}:${path}`;
}

/** The session topic a file's room hears on that the file was written by something else. */
function writtenTopic(path: string): string {
  return `file.written:${path}`;
}

/**
 * An r2-file driver that tells the session which of its files were changed outside what it holds:
 * an agent's write, a move or a removal. A held file writing itself tells nobody.
 *
 * @returns The driver, to `use` after the storage drivers.
 */
export function reportChanges(): FileDriver {
  return {
    async write(ctx) {
      report(ctx.path);
    },
    async mkdir(ctx) {
      report(ctx.path);
    },
    async copy(ctx) {
      report(ctx.destination);
    },
    async move(ctx) {
      report(ctx.path, true);
      report(ctx.destination);
    },
    async link(ctx) {
      report(ctx.path);
    },
    async update(ctx) {
      report(ctx.path);
    },
    async remove(ctx) {
      report(ctx.path, true);
    },
    async restore(ctx) {
      report(ctx.path);
    },
  };
}

/** Broadcasts a changed file to the session by its home path; files outside the home aren't the desktop's. */
function report(storagePath?: string, removed = false): void {
  const home = fsContext.get()?.homeDir;
  if (!home || !storagePath?.startsWith(`${home}/`) || getContext(AT_REST)) return;
  const path = `~${storagePath.slice(home.length)}`;
  SESSION_STORE.broadcast<FileChange>(FILE_CHANGED, { path, removed });
  SESSION_STORE.broadcast(writtenTopic(path), path);
}
