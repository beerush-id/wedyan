import { type RoomSetup, SESSION_STORE, stream } from '@irpclib/irpc';
import { mutable } from '@irpclib/irpc/core';
import { type DocumentPresence, documentPresence, type PresenceQueries, partKey } from './document.h.js';
import { kernel } from './package.js';

kernel.construct(documentPresence, (path) => {
  const member = SESSION_STORE.room(`document:${path}`, createPresence);
  // This desktop, as the room knows it: what it opened goes when it leaves.
  const desktop = crypto.randomUUID();

  return stream<DocumentPresence, PresenceQueries>(
    (state) => {
      state.data = member.data;
      state.answer('open', (part, id, actor) => member.ask('open', desktop, partKey(part, id), actor));
      state.answer('close', (actor) => member.ask('close', desktop, actor));
      return () => {
        member.ask('leave', desktop);
        member.leave();
      };
    },
    { ready: false, parts: {} },
  );
});

/**
 * Builds a document's presence room: who has which part open, and on which desktop, so a part
 * opened on a desktop that leaves never stays shown as worked on.
 */
function createPresence(_setup: RoomSetup) {
  const data = mutable<DocumentPresence>({ ready: true, parts: {} });
  // What each actor has open, and the desktop it opened it on.
  const opened = new Map<string, { key: string; desktop: string }>();

  const drop = (actor: string) => {
    const was = opened.get(actor);
    if (!was) return;
    opened.delete(actor);
    const left = (data.parts[was.key] ?? []).filter((on) => on !== actor);
    if (left.length) data.parts[was.key] = left;
    else delete data.parts[was.key];
  };

  return {
    data,
    commands: {
      open: (desktop: string, key: string, actor: string) => {
        drop(actor);
        opened.set(actor, { key, desktop });
        data.parts[key] = [...(data.parts[key] ?? []), actor];
        return true;
      },
      close: (_desktop: string, actor: string) => {
        drop(actor);
        return true;
      },
      leave: (desktop: string) => {
        for (const [actor, was] of [...opened]) if (was.desktop === desktop) drop(actor);
        return true;
      },
    },
  };
}
