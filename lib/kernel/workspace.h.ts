import { onCleanup } from '@airlib/react';
import type { AnyType, RemoteState } from '@irpclib/irpc';
import { isBrowser, type StateChange } from '@irpclib/irpc/core';
import { logger } from '../logger.js';
import { kernel } from './package.js';

/** The workspace stream's state: when its connection opened, 0 until it does; a new one means it reconnected. */
export type WorkspaceState = { connected: number };

/** How a file's content is held: parsed `json`, or `text`. */
export type FileEncoding = 'json' | 'text';

/**
 * What goes both ways on the workspace stream. A desktop opens a file (`open`), getting the content
 * the session holds, and sends each change it makes (`change`). The workspace passes another's change
 * on to be replayed (`replay`), and says a file was written outside what's held, by its home path
 * (`~/…`), and whether it's gone (`changed`).
 */
export type WorkspaceQueries = {
  open: (path: string, encoding: FileEncoding) => unknown;
  change: (path: string, encoding: FileEncoding, event: AnyType) => boolean;
  replay: (path: string, encoding: FileEncoding, event: AnyType) => boolean;
  changed: (path: string, removed: boolean) => boolean;
};

/**
 * Joins the session's workspace, as one desktop: one stream for every file it holds, whatever their
 * number. Opened by `fileRef`, for the tab's life; apps don't call it themselves.
 */
export const workspace = kernel.declare<() => RemoteState<WorkspaceState, WorkspaceQueries>>({
  name: 'workspace',
  stream: true,
  keepAlive: true,
  controlled: true,
  coalesce: false,
  seed: () => ({ connected: 0 }),
});

export type LoungeState = {
  id: string;
  connected: number;
};
export type LoungeQueries = {
  message: (event: LoungeMessage) => boolean;
};

export const lounge = kernel.declare<() => RemoteState<LoungeState, LoungeQueries>>('lounge', {
  stream: true,
  keepAlive: true,
  controlled: true,
  coalesce: false,
  seed: () => ({ id: '', connected: 0 }),
});

/** What a lounge message says happened. */
export const LOUNGE_EVENT = { RENAMED: 'renamed', CREATED: 'created', REMOVED: 'removed', PORTRAIT: 'portrait' } as const;

export type LoungeMessage = {
  type: string;
  data?: AnyType;
  event?: StateChange;
};

export type LoungeMember = (event: LoungeMessage) => void;

class Lounge {
  public remote?: ReturnType<typeof lounge>;
  private listeners = new Set<LoungeMember>();

  public ask(msg: LoungeMessage) {
    void this.remote?.ask('message', msg);
  }

  public broadcast(msg: LoungeMessage) {
    for (const handler of this.listeners) {
      try {
        handler(msg);
      } catch (e) {
        logger.error(e);
      }
    }
  }

  public subscribe(handler: LoungeMember) {
    if (typeof handler !== 'function') return () => {};
    this.listeners.add(handler);
    const unsubscribe = () => this.listeners.delete(handler);
    onCleanup(unsubscribe);
    return unsubscribe;
  }
}

export let LOUNGE = new Lounge();

if (import.meta?.hot) {
  if ((window as AnyType).WEDYAN_WORKSPACE) {
    LOUNGE = (window as AnyType).WEDYAN_WORKSPACE;
    LOUNGE.remote?.close();
  }
  (window as AnyType).WEDYAN_WORKSPACE = LOUNGE;
}

if (isBrowser()) {
  const remote = lounge();

  void remote.answer('message', (msg) => {
    LOUNGE.broadcast(msg);
    return true;
  });

  LOUNGE.remote = remote;
}
