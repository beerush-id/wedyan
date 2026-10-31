import { subscribe } from '@airlib/react';
import type { DockSubmitEvent } from '@airlib/react-aui/desktop';
import { IRPC_STATUS, type IRPCData } from '@irpclib/irpc';
import { isBrowser } from '@irpclib/irpc/core';
import { commandResult, userTurn } from '@/lib/assistant/turns.js';
import { conversation, DUPLICATE_CLIENT, type UserMessage } from '@/lib/kernel/chat.h.js';
import { hear, speak, voice } from '@/lib/speech/speech.h.js';
import { type CommandSuggestion, promptContext, runCommand } from '@/lib/systems/registry.js';
import { createPlayer, openMicrophone, playClip, stopClip } from './audio.js';
import { answerDocuments } from './binding.js';
import { createHandsFree } from './hands-free.js';
import { PROFILE_PATH, type UserProfile } from './profile.js';
import { createWidgets } from './widgets.js';
import { fileRef } from './workspace.js';

/** Where a tab keeps its own ID, for itself and across its reloads. */
const TAB_KEY = 'wedyan.tab';

/**
 * Opens the user's conversation with Wedyan, as this desktop: the one thing a desktop calls, and
 * what the dock is wired to. It owns everything only the kernel needs: the tab's own ID, kept across
 * reloads and made anew for a duplicated tab, and the answers that let agents work in the documents
 * this desktop's windows bind.
 *
 * @returns `ask`, the dock's `onsubmit`; `widgets`, the dock's list, live from the conversation;
 *   `speech`, the dock's voice: what it shows and toggles, hands-free; `stop`, which stops every
 *   answer being written and spoken; `ack`, which says a widget is done; `answer`, to register what
 *   the server asks of the desktop, run once what comes before it has been spoken; and `chat`, the
 *   conversation itself.
 */
export function wedyan() {
  const chat = conversation.later();
  if (isBrowser()) answerDocuments(chat);

  const { widgets, sync } = createWidgets((message) => ({
    ...userTurn({ text: message.text, selections: message.selections ?? [] } as never),
    id: message.id,
  }));

  const handsFree = createHandsFree({
    microphone: openMicrophone,
    player: createPlayer,
    hear: () => hear() as never,
    voice: (name) => voice(name) as never,
    voiceOf: () => fileRef<UserProfile>(PROFILE_PATH).data?.voice,
    send: (text) => chat.ask('send', { text, context: promptContext() as unknown as Record<string, IRPCData> }),
    clip: async (text, name) => {
      const { audio, type } = await speak(text, name);
      await playClip(audio, type);
    },
    stopClip,
  });
  const { speech } = handsFree;

  const update = () => {
    sync(chat.data.messages);
    handsFree.sync(chat.data.messages);
  };
  subscribe(chat.data, update);

  // A duplicated tab brings its original's ID, refused while the original is open: it opens again
  // with one of its own.
  chat.subscribe(() => {
    update();
    if (chat.status === IRPC_STATUS.ERROR && chat.error?.message.includes(DUPLICATE_CLIENT)) {
      // Once the refusal has settled on the reader, not while it's still being told of it.
      queueMicrotask(() => void chat.dispatch(tabId(true)));
    }
  });
  void chat.dispatch(tabId());

  const stop = () => {
    speech.stop();
    void chat.ask('stop');
  };

  /** Registers what the server asks of the desktop: spoken words come first, then what they lead to. */
  const answer: typeof chat.answer = (name, handler) =>
    chat.answer(name, async (...args: never[]) => {
      await handsFree.played((args[1] as { after: number } | undefined)?.after ?? -1);
      return (handler as (...args: unknown[]) => unknown)(...args);
    });

  /** Whether any answer to the user's words is still being written. */
  const answering = () =>
    chat.data.messages.some(
      (message) => message.role === 'agent' && !message.event && ['idle', 'running'].includes(message.status),
    );

  let latest: DockSubmitEvent | undefined;

  /** Runs a command picked into a prompt: its bubble and what it draws are local, nothing sends or keeps them. */
  const command = async (name: string, event: DockSubmitEvent): Promise<void> => {
    widgets.push(userTurn(event));
    try {
      const view = await runCommand(name, { event: { ...event, context: promptContext() }, signal: event.signal });
      if (view !== undefined && view !== null) widgets.push(commandResult(view));
    } catch (error) {
      if (!event.signal.aborted) widgets.push(commandResult((error as Error).message));
    }
  };

  /**
   * The dock's `onsubmit`: a picked command runs here; anything else is sent as the user's words, and
   * this lasts until they're answered, so the dock shows it's at work.
   */
  const ask = async (event: DockSubmitEvent): Promise<void> => {
    latest = event;
    const picked = event.selections.find((item) => item.type === 'command') as CommandSuggestion | undefined;
    if (picked) return command(picked.name, event);

    await chat.ask('send', {
      text: event.text,
      context: promptContext() as unknown as Record<string, IRPCData>,
      selections: event.selections as unknown as UserMessage['selections'],
    });

    await new Promise<void>((resolve) => {
      if (!answering()) return resolve();
      const finish = () => {
        unsubscribe();
        resolve();
      };
      const unsubscribe = subscribe(chat.data, () => {
        if (!answering()) finish();
      });
      // The dock aborts a prompt both when it's stopped and when a newer one replaces it, just before
      // sending the newer. Answers run side by side, so only a real stop stops anything.
      event.signal.addEventListener('abort', () => {
        queueMicrotask(() => {
          if (latest === event) stop();
          finish();
        });
      });
    });
  };

  return {
    ask,
    widgets,
    speech,
    stop,
    ack: (widget: string, form: Record<string, IRPCData>) => chat.ask('ack', widget, form),
    answer,
    chat,
  };
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
