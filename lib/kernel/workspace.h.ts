import type { RemoteState } from '@irpclib/irpc';
import { kernel } from './package.js';

/** The workspace stream's state: when its connection opened, 0 until it does; a new one means it reconnected. */
export type WorkspaceState = { connected: number };

/**
 * What the workspace asks a desktop: one of the session's files changed (`changed`), by its home
 * path (`~/…`), whoever changed it: a window, an agent, or another tab.
 */
export type WorkspaceQueries = {
  changed: (path: string) => boolean;
};

/**
 * Joins the session's workspace, as one desktop: one stream that tells it every file changed in the
 * session, for it to keep what it holds in sync. Opened by `fileRef`, for the tab's life; apps don't
 * call it themselves.
 */
export const workspace = kernel.declare<() => RemoteState<WorkspaceState, WorkspaceQueries>>({
  name: 'workspace',
  stream: true,
  keepAlive: true,
  controlled: true,
  coalesce: false,
  seed: () => ({ connected: 0 }),
});
