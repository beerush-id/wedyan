import { createContext, mutable, snapshot, subscribe } from '@airlib/react';
import { toast } from '@airlib/react-aui';
import type { DockSubmitEvent, DockWidgetAction, DockWidgetEntry } from '@airlib/react-aui/desktop';
import type { IRPCData } from '@irpclib/irpc';
import type { MouseEvent, ReactNode } from 'react';
import { ASK_REPLY } from '@/lib/kernel/chat.h.js';
import { wedyan } from '@/lib/share/wedyan.js';
import { isAppLink, requestLink, runCommand } from '@/lib/systems/registry.js';
import { answerActions } from './actions.js';
import { engine } from './mock.js';
import type { Answer, UserTurn } from './turns.js';

/** The open conversation, for what's drawn on the desktop. */
export type Session = ReturnType<typeof openSession>;

/** The session the desktop opened. Set where it's opened; everything drawn inside reads it. */
export const sessionCtx = createContext<Session>();

/**
 * Opens the user's conversation for this desktop, and answers what the dock reports: what's sent goes
 * to `wedyan()`, and what's pressed in a widget runs its command here, on the desktop.
 *
 * @returns What the dock is wired to, and what an answer's row needs.
 */
export function openSession() {
  const { ask, widgets, speech, stop, ack, answer, chat } = wedyan();
  const pressed = new Set<AbortController>();
  const state = mutable({ asking: 0, pressing: 0 });
  const prompt = mutable({ text: '' });
  const answers = mutable({ open: false });

  answerActions(answer as never);

  // The commands not moved off the mock yet still draw through it, into this list.
  engine.widgets = widgets;

  let problem = '';
  let heard = '';
  subscribe(speech, () => {
    if (speech.problem && speech.problem !== problem) toast.error(speech.problem);
    problem = speech.problem;
    // What's being said is what's being written: it's in the prompt as it comes, and leaves with it.
    if (speech.heard !== heard) prompt.text = speech.heard;
    heard = speech.heard;
  });

  /** Keeps the dock at work for as long as something no sent prompt is behind runs. */
  const pressing = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    pressed.add(controller);
    state.pressing += 1;
    try {
      return await work(controller.signal);
    } finally {
      pressed.delete(controller);
      state.pressing -= 1;
    }
  };

  return {
    state,
    prompt,
    answers,
    widgets,
    speech,

    /**
     * Sends a prompt from the dock, and counts as waiting until it's answered.
     *
     * @param event - The sent prompt.
     * @returns Once it's answered or stopped.
     */
    async ask(event: DockSubmitEvent): Promise<void> {
      state.asking += 1;
      try {
        await ask(event);
      } finally {
        state.asking -= 1;
      }
    },

    /** Whether something the user asked for is still coming: from the prompt, a press, or their voice. */
    get waiting(): boolean {
      if (state.asking > 0 || state.pressing > 0) return true;
      return chat.data.messages.some(
        (message) => message.role === 'agent' && !message.event && ['idle', 'running'].includes(message.status),
      );
    },

    /** Stops what's running from a press, and every answer being written and spoken. */
    stop() {
      for (const controller of pressed) controller.abort();
      stop();
    },

    /**
     * Runs what was pressed in a widget, whose result goes back to its host.
     *
     * @param press - What was pressed, and where.
     * @returns What the command drew.
     */
    run({ action, event, form, ctx, widget, widgetId }: DockWidgetAction): Promise<ReactNode> {
      return pressing(async (signal) => {
        // A form an agent asked: what it holds is the reply, and there's no command to run.
        if (action === ASK_REPLY)
          return void (await ack(widgetId as string, snapshot(form) as Record<string, IRPCData>));

        const acknowledge = (id: string, data: DockWidgetAction['form']) =>
          ack(id, snapshot(data) as Record<string, IRPCData>);
        const view = await runCommand(action, {
          event,
          form,
          ctx,
          signal,
          widget,
          widgetId,
          ack: acknowledge as never,
        });
        // The conversation settles its own widgets; only an answer drawn here stops waiting here.
        if ('at' in widget) widget.important = false;
        return view;
      });
    },

    /**
     * Sends what the user sent again.
     *
     * @param turn - The turn to send again.
     * @returns Once it's answered or stopped.
     */
    retry({ sent }: UserTurn): Promise<void> {
      return pressing((signal) => ask({ ...sent, signal }));
    },

    /**
     * Opens a link pressed in an answer, when it's Wedyan's to open.
     *
     * @param href - The link.
     * @param event - The press.
     */
    link(href: string, event: MouseEvent<HTMLElement>): void {
      if (!isAppLink(href)) return;
      event.preventDefault();
      void requestLink(href);
    },

    /**
     * Takes an entry off the list.
     *
     * @param widget - The entry.
     */
    dismiss(widget: DockWidgetEntry): void {
      const at = widgets.indexOf(widget);
      if (at > -1) widgets.splice(at, 1);
    },

    /**
     * When an entry came: as the conversation has it, or as the entry remembers it.
     *
     * @param widget - The entry.
     * @returns When, in milliseconds; nothing for what isn't a turn.
     */
    timeOf(widget: DockWidgetEntry): number | undefined {
      const message = chat.data.messages.find(({ id }) => id === widget.id);
      return message ? Date.parse(message.created) : (widget as Partial<Answer>).at;
    },
  };
}
