import { IRPC_STATUS } from '@irpclib/irpc';
import { isBrowser } from '@irpclib/irpc/core';
import { conversation, DUPLICATE_CLIENT } from '@/lib/kernel/chat.h.js';
import { answerDocuments } from './binding.js';

/** Where a tab keeps its own ID, for itself and across its reloads. */
const TAB_KEY = 'wedyan.tab';

/**
 * Opens the user's conversation with Wedyan, as this desktop: the one thing a desktop calls. It
 * owns everything only the kernel needs: the tab's own ID, kept across reloads and made anew for a
 * duplicated tab, and the answers that let agents work in the documents this desktop's windows
 * bind. The conversation it returns stays the same object through all of it.
 *
 * @returns The conversation, live: its `data`, `ask` to tell the server, `answer` for what the
 *   server asks of the desktop.
 */
export function wedyan() {
  const chat = conversation.later();
  if (isBrowser()) answerDocuments(chat);

  // A duplicated tab brings its original's ID, refused while the original is open: it opens again
  // with one of its own.
  chat.subscribe(() => {
    if (chat.status === IRPC_STATUS.ERROR && chat.error?.message.includes(DUPLICATE_CLIENT)) {
      // Once the refusal has settled on the reader, not while it's still being told of it.
      queueMicrotask(() => void chat.dispatch(tabId(true)));
    }
  });
  void chat.dispatch(tabId());
  return chat;
}

/** This tab's ID: the one it kept, or a new one, kept for its reloads. */
function tabId(fresh = false): string {
  const kept = fresh ? undefined : tabStorage()?.getItem(TAB_KEY);
  const id = kept || crypto.randomUUID();
  tabStorage()?.setItem(TAB_KEY, id);
  return id;
}

/** The tab's own storage, when there is one and it can be used. */
function tabStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
