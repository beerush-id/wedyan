import { SESSION_STORE, stream } from '@irpclib/irpc';
import type { FileDriver } from '@irpclib/r2-file/adapter';
import { fsContext } from '@irpclib/r2-file/context';
import { kernel } from './package.js';
import { type WorkspaceQueries, type WorkspaceState, workspace } from './workspace.h.js';

/** The session topic every change to the session's files goes out on, by its home path. */
const FILE_CHANGED = 'workspace.changed';

kernel.construct(workspace, () =>
  stream<WorkspaceState, WorkspaceQueries>(
    (state) => {
      const member = SESSION_STORE.join<string>(FILE_CHANGED, (path) => {
        void state.ask('changed', path);
      });
      state.data = { connected: Date.now() };
      return () => member.leave();
    },
    { connected: 0 },
  ),
);

/**
 * An r2-file driver that tells the session's desktops which of its files changed, after every
 * change made through r2-file: a window's save, an agent's write, a move or a removal.
 *
 * @returns The driver, to `use` after the storage drivers.
 */
export function reportChanges(): FileDriver {
  return {
    async write(ctx) {
      report(ctx.path);
    },
    async copy(ctx) {
      report(ctx.destination);
    },
    async move(ctx) {
      report(ctx.path);
      report(ctx.destination);
    },
    async link(ctx) {
      report(ctx.path);
    },
    async remove(ctx) {
      report(ctx.path);
    },
    async restore(ctx) {
      report(ctx.path);
    },
  };
}

/** Broadcasts a changed file to the session by its home path; files outside the home aren't the desktop's. */
function report(storagePath?: string): void {
  const home = fsContext.get()?.homeDir;
  if (!home || !storagePath?.startsWith(`${home}/`)) return;
  SESSION_STORE.broadcast(FILE_CHANGED, `~${storagePath.slice(home.length)}`);
}
