import { mutable } from '@airlib/react';
import type { DockWidgetEntry, DockWidgetPart } from '@airlib/react-aui/desktop';
import { type AskPart, type AskStep, MOTION_PICTURE, MOTION_VOICE, type WidgetPart } from '@/lib/kernel/agent.h.js';
import { type AgentMessage, type ConversationMessage, INTERRUPTED, type UserMessage } from '@/lib/kernel/chat.h.js';

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

  const clear = () => {
    widgets.splice(0);
    added.clear();
    answers.clear();
  };

  return {
    widgets,
    clear,
    sync(messages: ConversationMessage[]) {
      // Cleared, here or on another desktop.
      if (!messages.length && added.size) clear();
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
 * and a widget: a placeholder while it's composed, then whole, or a line saying it couldn't be drawn.
 */
function shownParts(message: AgentMessage): DockWidgetPart[] {
  const calls = (message.steps ?? []).filter(({ kind }) => kind === 'call');
  const rowsAfter = (index: number) => calls.filter(({ after }) => after === index).map(callRow);
  const parts = message.parts.flatMap((part, index): DockWidgetPart[] => {
    const rows = rowsAfter(index);
    if (part.type === 'text') return [{ type: 'text', text: part.text ?? part.chunks.join('') }, ...rows];
    if (part.status === 'error') return [{ type: 'text', text: UNDRAWN }, ...rows];
    return [part.status === 'ready' ? dockWidget(part) : drawing(part), ...rows];
  });
  const shown = [...rowsAfter(-1), ...parts];
  if (message.reason === INTERRUPTED) return [...shown, { type: 'text', text: CUT_OFF }];
  return message.status === 'error' && message.reason ? [...shown, { type: 'text', text: message.reason }] : shown;
}

/** What an answer that was cut off says, so it isn't left empty. */
const CUT_OFF = 'This answer was cut off before it finished. Please ask again.';

/** What the user reads a call as, whether it's under way or done. */
const CALL_LABELS: Record<string, string> = {
  'memory.recall': 'Memory search',
  'memory.save': 'Memory note',
  'r2-file.list': 'Folder',
  'r2-file.read': 'File',
  'r2-file.search': 'File search',
  'r2-file.stat': 'File details',
  'sys.photos.search': 'Photo search',
  'sys.image.generate': 'New image',
  'sys.still.generate': 'New image',
  'sys.motion.create': 'New project',
  'sys.motion.cast': 'New cast',
  'sys.motion.still': 'New still',
  'sys.motion.stage': 'New stage',
  [MOTION_PICTURE]: 'Picture',
  [MOTION_VOICE]: 'Voice',
};

/** A call as a row of its answer: what it is, what it's working on, and how long it took. */
function callRow({ name, detail, ms }: AskStep): DockWidgetPart {
  return { type: 'activity', label: CALL_LABELS[name] ?? name, detail, time: ms === undefined ? undefined : durationOf(ms) };
}

/**
 * How long something took, as it's read.
 *
 * @param ms - The time, in milliseconds.
 * @returns E.g. `640 ms` or `1.6 s`.
 */
function durationOf(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** What a widget that couldn't be composed leaves in its place. */
const UNDRAWN = "That card couldn't be drawn.";

/** A widget still being composed: a card in AUI's loading state, its lines shimmering until it's ready. */
function drawing(part: WidgetPart): DockWidgetPart {
  return {
    type: 'widget',
    id: `${part.id}-drawing`,
    status: 'pending',
    children: [{ role: 'card-body', props: { 'aria-busy': 'true' }, children: [{ role: 'p' }, { role: 'p' }, { role: 'p' }] }],
  } as DockWidgetPart;
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
    // A widget draws once, so its placeholder gives way to it instead of being written over.
    if (!current || current.type !== part.type || idOf(current) !== idOf(part)) parts[index] = part;
    else Object.assign(current, part);
  }
}

/** A part's id, which only a widget has. */
function idOf(part: DockWidgetPart): string | undefined {
  return (part as { id?: string }).id;
}

/** Whether a part of an answer waits on the user. */
function isWaiting(part: AskPart): boolean {
  return part.type === 'widget' && part.status === 'ready' && !!part.formAction && !part.settled;
}
