import { mutable } from '@airlib/react';
import type { DockWidgetEntry, DockWidgetPart } from '@airlib/react-aui/desktop';
import type { AskPart, AskStep, WidgetPart } from '@/lib/kernel/agent.h.js';
import type { AgentMessage, ConversationMessage, UserMessage } from '@/lib/kernel/chat.h.js';

/** How a user's words are drawn, as the desktop draws what's just been sent. */
export type UserTurn = (message: UserMessage) => DockWidgetEntry;

/** An answer's entry, with what the conversation updates in it. */
type AnswerEntry = { entry: DockWidgetEntry; parts: DockWidgetPart[]; waiting: { important: boolean } };

/**
 * The dock's list, kept from the conversation: what the user said and what Wedyan answered, as the
 * dock's own entries. The list stays the desktop's: what a command draws can be added to it, and
 * what's dismissed from it stays gone, since an entry is only ever added once.
 *
 * @param userTurn - How the user's words are drawn.
 * @returns The list, and what brings it up to date with the conversation.
 */
export function createWidgets(userTurn: UserTurn) {
  const widgets = mutable([] as DockWidgetEntry[], { recursive: false });
  const added = new Set<string>();
  const answers = new Map<string, AnswerEntry>();

  const syncAnswer = (message: AgentMessage) => {
    const shown = shownParts(message);
    let answer = answers.get(message.id);
    // Thinking shows on the dock itself: an answer takes its place once it has something to show.
    if (!answer && !shown.length) return;
    if (!answer) {
      answer = newAnswer(message.id);
      answers.set(message.id, answer);
      if (!added.has(message.id)) widgets.push(answer.entry);
      added.add(message.id);
    }
    fill(answer.parts, shown);
    answer.waiting.important = message.parts.some(isWaiting);
  };

  return {
    widgets,
    sync(messages: ConversationMessage[]) {
      for (const message of messages) {
        if (message.role === 'agent') {
          syncAnswer(message);
        } else if (!added.has(message.id)) {
          added.add(message.id);
          widgets.push(userTurn(message));
        }
      }
    },
  };
}

/** A new answer's entry; what changes in it reacts for itself, as the shallow list asks. */
function newAnswer(id: string): AnswerEntry {
  const parts = mutable<DockWidgetPart[]>([]);
  const waiting = mutable({ important: false });
  const entry: DockWidgetEntry = {
    id,
    children: parts,
    get important() {
      return waiting.important;
    },
  };
  return { entry, parts, waiting };
}

/**
 * What an answer shows so far, as the dock's parts: its words, each call where it fell among them,
 * and a widget only once it's composed, whole.
 */
function shownParts(message: AgentMessage): DockWidgetPart[] {
  const calls = (message.steps ?? []).filter(({ kind }) => kind === 'call');
  const rowsAfter = (index: number) => calls.filter(({ after }) => after === index).map(callRow);
  const parts = message.parts.flatMap((part, index): DockWidgetPart[] => {
    const rows = rowsAfter(index);
    if (part.type === 'text') return [{ type: 'text', text: part.text ?? part.chunks.join('') }, ...rows];
    return part.status === 'ready' ? [dockWidget(part), ...rows] : rows;
  });
  const shown = [...rowsAfter(-1), ...parts];
  return message.status === 'error' && message.reason ? [...shown, { type: 'text', text: message.reason }] : shown;
}

/** A call as a row of its answer: what it is, what it's working on, and how long it took. */
function callRow({ name, detail, ms }: AskStep): DockWidgetPart {
  const call = detail ? `${name} ${detail}` : name;
  return { type: 'text', text: `\`${call}\` ${ms === undefined ? '…' : `${ms} ms`}` };
}

/** A composed widget as the dock takes it. */
function dockWidget(part: WidgetPart): DockWidgetPart {
  return {
    type: 'widget',
    id: part.id,
    status: part.settled ? 'settled' : 'pending',
    children: part.nodes,
    ...(part.props ? { props: part.props } : {}),
    ...(part.form ? { form: part.form } : {}),
    ...(part.formAction ? { formAction: part.formAction } : {}),
    ...(part.once ? { once: part.once } : {}),
  } as DockWidgetPart;
}

/** Writes what's shown into the list the dock draws, in place, so a growing part keeps its place. */
function fill(parts: DockWidgetPart[], shown: DockWidgetPart[]): void {
  for (const [index, part] of shown.entries()) {
    const current = parts[index];
    if (!current || current.type !== part.type) parts[index] = part;
    else Object.assign(current, part);
  }
}

/** Whether a part of an answer waits on the user. */
function isWaiting(part: AskPart): boolean {
  return part.type === 'widget' && part.status === 'ready' && !!part.formAction && !part.settled;
}
