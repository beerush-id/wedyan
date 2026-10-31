import { type AnyType, mutable, snapshot } from '@airlib/react';
import type { DockSubmitEvent, DockWidgetAction, DockWidgetEntry, DockWidgetPart } from '@airlib/react-aui/desktop';
import type { WidgetNode } from '@airlib/react-aui/dynamic';
import type { MouseEvent, ReactNode } from 'react';
import { listing as calendarListing } from '@/apps/calendar/views/library.js';
import { listing as mailListing, nameOfPerson } from '@/apps/mail/views/library.js';
import { edit, memoAt, memos, memosOf, newMemo, shortDate } from '@/apps/memo/views/library.js';
import { animation, newMotion, ROOT as MOTIONS_ROOT } from '@/apps/motions/views/motion.js';
import { GENERATIVE, ROOT as PHOTOS_ROOT } from '@/apps/photos/views/library.js';
import { generation } from '@/apps/photos/views/options.js';
import { MODELS, settingsOf } from '@/lib/documents/generation.js';
import { documentAt, freePath, newHeader, supply } from '@/lib/documents/store.js';
import type { GeneratedAttempt, StillDocument } from '@/lib/documents/types.js';
import { linkTo } from '@/lib/systems/links.js';
import {
  type CommandHandle,
  type CommandSuggestion,
  isAppLink,
  type PromptEvent,
  promptContext,
  requestLink,
  runCommand,
  type WidgetAck,
} from '@/lib/systems/registry.js';
import { type Answer, commandResult, motionMade, stillMade, type UserTurn, userTurn } from './turns.js';

/** One answer being written, and what cuts it off. */
type Turn = { answer: DockWidgetEntry; signal: AbortSignal };

/** How long Wedyan seems to think before its first word, and how fast its words arrive. */
const THINKING = 500;
const WORD = 40;
/** How long each step of a job seems to take. */
const STEP = 700;

/** The labels a date and a time field read out. */
const DATE_LABELS = { previous: 'Previous month', next: 'Next month', year: 'Year' };
const TIME_LABELS = { hour: 'Hour', minute: 'Minute', period: 'Half of the day' };

/** How long the server seems to take to record a widget. */
const SAVING = 300;

/** A widget as an answer holds it. */
type WidgetPart = Extract<DockWidgetPart, { type: 'widget' }>;

/** Answers that are only words, as most of the agent's are: a table, then a pick and the reason for it. */
const COMPARISON = `Here's how the two cuts compare.

| | **Teaser** | **Full trailer** |
|---|---|---|
| Length | 15s | 1m 30s |
| Shots | 6 | 22 |
| Music | Lantern theme | Lantern theme, extended |
| Ready by | Nov 1 | Nov 8 |

I'd ship the **Teaser** first. It needs no new shots, and the full trailer still waits on the river scene.

At 24 frames a second the trailer is $90 \\times 24 = 2160$ frames, against $360$ for the teaser.`;

/** Steps, a checklist, and a warning set apart. */
const PLAN = `Here's a plan for the lantern shoot.

## This week

1. **Lock the budget.** The lighting line is the only one still open.
2. **Confirm the cast.** Three actors are in; the fourth answers by Friday.
3. **Scout the river.** Go at dusk, so you see the light you'll shoot in.

## Before the day

- [x] Moodboard approved
- [x] Actors confirmed
- [ ] Permit for the river bank
- [ ] Backup lanterns

> Dusk gives you about 40 minutes of usable light, so the crew call has to be early.`;

/** A draft to read and copy: quoted words, then a fenced block. */
const DRAFT = `Here's a reply to **Rudi**.

> Hi Rudi,
>
> Thanks for the budget. The lighting line looks high for a two-night shoot. Can we go through it before Friday?

If you'd rather keep it short, use the \`one-line\` version:

\`\`\`text
Budget looks good except lighting. Can we talk before Friday?
\`\`\``;

/**
 * The conversation document, for this session: every widget the agent has sent, by id, as the server
 * would keep it. `ack` overwrites one's form and settles it; what commands draw never gets here.
 */
const conversation = new Map<string, WidgetPart>();

/** Commands running from widgets, which the dock's stop reaches through `busy`. */
const pressed = new Set<AbortController>();

let widgetCount = 0;
let answerCount = 0;

/**
 * The engine, standing in for the real one until it's wired: nothing leaves the desktop. It owns the
 * list the dock draws, and hears everything that happens to it. Its answers are what the agent will
 * send — words, and UI described as data — and what they do is asked of commands and links, never
 * drawn by a component of their own.
 */
export const engine = {
  /** What the dock shows of Wedyan: whether it's listening or speaking, and how many pressed commands are running. */
  state: mutable({ listening: false, speaking: false, pressing: 0 }),

  /** Everything above the dock, oldest first. Shallow: an answer reacts for itself as it grows. */
  widgets: mutable([] as DockWidgetEntry[], { recursive: false }),

  /**
   * Handles what was sent: draws it as a turn, then runs its command, or answers it. A command's
   * bubble and result are local: nothing here sends or keeps them.
   *
   * @param sent - The sent prompt.
   * @returns Once it's finished, stopped, or replaced.
   */
  async submit(sent: DockSubmitEvent): Promise<void> {
    const event: PromptEvent = { ...sent, context: promptContext() };
    const picked = sent.selections.find((item) => item.type === 'command') as CommandSuggestion | undefined;
    if (picked) event.command = () => runCommand(picked.name, { event, signal: sent.signal });

    engine.widgets.push(userTurn(sent));
    try {
      if (!event.command) return await respond(event);
      show(await event.command());
    } catch (error) {
      if (sent.signal.aborted) return;
      if (!event.command) throw error;
      show((error as Error).message);
    } finally {
      engine.state.speaking = false;
    }
  },

  /**
   * Sends what the user sent again, as a turn of its own. Nothing in the prompt is behind it, so the
   * dock's stop reaches it through `busy`.
   *
   * @param turn - The turn to send again.
   * @returns Once it's finished or stopped.
   */
  async retry({ sent }: UserTurn): Promise<void> {
    const controller = new AbortController();
    pressed.add(controller);
    engine.state.pressing += 1;
    try {
      await engine.submit({ ...sent, signal: controller.signal });
    } finally {
      pressed.delete(controller);
      engine.state.pressing -= 1;
    }
  },

  /**
   * Runs what was pressed in a widget. Its result goes back to the widget's host; an answered widget
   * stops waiting on the user.
   *
   * @param press - What was pressed, and where.
   * @returns What the command drew.
   */
  async run({ action, event, form, ctx, widget, widgetId }: DockWidgetAction): Promise<ReactNode> {
    const controller = new AbortController();
    pressed.add(controller);
    engine.state.pressing += 1;
    try {
      const ack: WidgetAck = (id, data) => engine.ack(id, snapshot(data));
      const view = await runCommand(action, { event, form, ctx, signal: controller.signal, widget, widgetId, ack });
      widget.important = false;
      return view;
    } finally {
      pressed.delete(controller);
      engine.state.pressing -= 1;
    }
  },

  /** Stops the commands running from widgets; a sent prompt stops through its own signal. */
  stop(): void {
    for (const controller of pressed) controller.abort();
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
    const at = engine.widgets.findIndex((each) => each.id === widget.id);
    if (at >= 0) engine.widgets.splice(at, 1);
  },

  /**
   * Stands in for the server recording a widget: overwrites its form in the document, and settles it.
   *
   * @param widgetId - The widget's id.
   * @param data - The values to keep.
   * @returns Once it's recorded.
   */
  async ack(widgetId: string, data: Parameters<WidgetAck>[1]): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVING));
    const widget = conversation.get(widgetId);
    if (widget) Object.assign(widget, { form: data, status: 'settled' });
  },
};

/**
 * Picks what a prompt calls for, as the agent would: the window in front — a prompt sent over Photos
 * or Motions' library makes something — then its words.
 *
 * @param event - The sent prompt.
 * @returns Once the answer is finished.
 */
async function respond({ text, signal, context }: PromptEvent): Promise<void> {
  const front = context.activeWindow;

  await pause(THINKING, signal);
  if (/\b(brief|recap|catch me up)\b/i.test(text)) return brief(begin(signal));
  if (/\b(compare|versus)\b/i.test(text)) return say(begin(signal), COMPARISON);
  if (/\bplan\b/i.test(text)) return say(begin(signal), PLAN);
  if (/\b(draft|reply)\b/i.test(text)) return say(begin(signal), DRAFT);
  if (front?.app === 'photos') return makeStill(begin(signal), text, (front.data as { still?: string })?.still);
  if (front?.name === 'library') return makeMotion(begin(signal), text);
  if (/\breplay\b/i.test(text)) return replay(begin(signal));
  if (/\bmeet(ing)?\b/i.test(text)) return meeting(begin(signal, true), text);
  if (/\b(mark|clear)\b.*\b(read|mail|inbox)\b/i.test(text)) return askMarkRead(begin(signal, true));
  if (/\b(mail|inbox|unread)\b/i.test(text)) return showMail(begin(signal));
  if (/\b(today|schedule|calendar|agenda|week)\b/i.test(text)) return showSchedule(begin(signal));
  if (/\bmemos?\b/i.test(text)) return showMemos(begin(signal));
  return say(begin(signal), `This is a stand-in answer until I'm wired up. You asked: **${text}**.`);
}

/** `/generate`: makes images of what the prompt says, keeps them, and shows what it made. */
export const generateImages: CommandHandle = async ({ event, signal }) => {
  const { activeWindow } = (event as PromptEvent).context;
  const plan = stillPlan(promptText(event), (activeWindow?.data as { still?: string })?.still);
  const attempts: GeneratedAttempt[] = [];
  for (let at = 0; at < plan.count; at++) attempts.push(await drawImage(plan, signal));
  return stillMade(plan.ask, keepStill(attempts, plan.ask, plan.still), attempts[0].src);
};

/** `/animate`: makes a motion of what the prompt says, keeps it, and shows what it made. */
export const generateMotion: CommandHandle = async ({ event, signal }) => {
  const ask = promptText(event) || NEW_MOTION;
  await pause(MOTION_STEP * MOTION_PHASES.length, signal);
  const { cover, path } = await keepMotion(ask);
  return motionMade(ask, path, cover);
};

/** `/note` and `/remember`: keeps what the prompt says as a memo. */
export const remember: CommandHandle = async ({ event, signal }) => {
  const turn = begin(signal);
  const text = promptText(event);
  if (!text) return say(turn, 'What should I keep?');
  const path = newMemo();
  const memo = memoAt(path);
  if (memo) {
    edit(memo, () => {
      memo.name = nameFrom(text);
      memo.body = text;
    });
  }
  await say(turn, 'Kept it.');
  add(turn, rows('Memo', [{ title: nameFrom(text), meta: shortDate(new Date().toISOString()), href: linkTo('memo', path) }]));
};

/** `/summarize`: asks which memo, as a form whose submit is `system.memo.summarize`. */
export const askSummary: CommandHandle = async ({ signal }) => {
  const turn = begin(signal, true);
  const options = memos().slice(0, 3);
  await say(turn, 'Which one should I sum up?');
  add(turn, {
    type: 'widget',
    form: { memo: options[0]?.path ?? '' },
    formAction: 'system.memo.summarize',
    once: true,
    children: [
      {
        role: 'card-body',
        children: [
          {
            role: 'select',
            props: {
              size: 'sm',
              label: 'Memo',
              options: Object.fromEntries(options.map(({ path, document }) => [path, document.name])),
            },
            bindings: [{ prop: 'value', state: '$this.form.memo', writable: true }],
          },
        ],
      },
      { role: 'card-actions', children: [submit('Sum it up')] },
    ],
  });
};

/**
 * Starts an answer above the dock.
 *
 * @param signal - What cuts it off.
 * @param important - Whether it waits on the user, which marks it until it's answered.
 * @returns The turn.
 */
function begin(signal: AbortSignal, important = false): Turn {
  // The list keeps the entry as it is, so what changes in it reacts for itself.
  const waiting = mutable({ important });
  const answer: Answer = {
    id: `answer-${++answerCount}`,
    at: Date.now(),
    children: mutable<DockWidgetPart[]>([]),
    get important() {
      return waiting.important;
    },
    set important(important: boolean) {
      waiting.important = important;
    },
  };
  engine.widgets.push(answer);
  return { answer, signal };
}

/**
 * Adds what a `/` command drew to the list, when it drew anything.
 *
 * @param view - What it drew.
 */
function show(view: ReactNode): void {
  if (view !== undefined && view !== null) engine.widgets.push(commandResult(view));
}

/**
 * The parts of an answer, which it always has while it's written.
 *
 * @param turn - The answer.
 * @returns Its live parts.
 */
function partsOf(turn: Turn): DockWidgetPart[] {
  return turn.answer.children as DockWidgetPart[];
}

/**
 * The form of the widget just added, live: writing to it updates what's drawn.
 *
 * @param turn - The answer.
 * @returns Its last part's form.
 */
function lastForm(turn: Turn) {
  return (partsOf(turn).at(-1) as WidgetPart).form as Record<string, AnyType>;
}

/**
 * Adds a part to an answer. A widget gets the id the server would give it, and is kept in the
 * document, apart from what the answer draws.
 *
 * @param turn - The answer.
 * @param part - What's added.
 */
function add(turn: Turn, part: DockWidgetPart): void {
  if (part.type === 'text') {
    partsOf(turn).push(part);
    return;
  }
  const widget = { ...part, id: part.id ?? `w_${++widgetCount}`, status: part.status ?? 'pending' };
  conversation.set(widget.id, structuredClone(widget));
  partsOf(turn).push(widget);
}

/**
 * Draws every widget again as the document holds it, as reopening the conversation would: what was
 * acknowledged comes back filled in and locked, without what its command drew.
 *
 * @param turn - The answer.
 * @returns Once it's shown.
 */
async function replay(turn: Turn): Promise<void> {
  await say(turn, conversation.size ? 'Here is what the conversation kept.' : 'No widgets yet.');
  for (const widget of conversation.values()) partsOf(turn).push(structuredClone(widget));
}

/**
 * Words arriving in an answer, one by one.
 *
 * @param turn - The answer.
 * @param text - What's said, as Markdown.
 * @returns Once it's all said.
 */
async function say(turn: Turn, text: string): Promise<void> {
  const children = partsOf(turn);
  children.push({ type: 'text', text: '' });
  const part = children[children.length - 1] as { text: string };
  const words = text.split(' ');
  engine.state.speaking = true;
  try {
    for (let count = 1; count <= words.length; count++) {
      part.text = words.slice(0, count).join(' ');
      await pause(WORD, turn.signal);
    }
  } finally {
    engine.state.speaking = false;
  }
}

/**
 * What a prompt asks of Photos: Photos' options in the dock, or a still window's own settings.
 *
 * @param prompt - What to make.
 * @param still - The still in front, if there's one.
 * @returns What to make, what with, and the still it joins, if any.
 */
function stillPlan(prompt: string, still?: string) {
  const target = still ? documentAt<'still'>(still) : undefined;
  const settings = target ? settingsOf(target) : undefined;
  return {
    ask: prompt || target?.prompt || 'Something new',
    model: settings?.model ?? generation.model,
    aspect: settings?.aspect ?? generation.aspect,
    count: settings?.batch ?? generation.count,
    still: target && still,
  };
}

/**
 * Makes one image.
 *
 * @param plan - What to make.
 * @param signal - What cuts it off.
 * @returns The image.
 */
async function drawImage({ ask, model, aspect }: ReturnType<typeof stillPlan>, signal: AbortSignal): Promise<GeneratedAttempt> {
  await pause(STEP, signal);
  const id = crypto.randomUUID();
  return { id, src: pictureFor(id, aspect), prompt: ask, settings: { model, aspect }, created: new Date().toISOString() };
}

/**
 * Makes images as the agent would, saying so and showing each as it arrives, and keeps them in a
 * still: the one in front, or a new one.
 *
 * @param turn - The answer.
 * @param prompt - What to make.
 * @param still - The still in front, if there's one.
 * @returns Once they're made.
 */
async function makeStill(turn: Turn, prompt: string, still?: string): Promise<void> {
  const plan = stillPlan(prompt, still);
  const { ask, model, aspect, count } = plan;

  await say(turn, `Making ${count === 1 ? 'an image' : `${count} images`} of **${ask}**.`);
  add(turn, job(ask, `${MODELS.still[model]} · ${aspect}`, 'Images'));

  const form = lastForm(turn);
  const attempts: GeneratedAttempt[] = [];
  for (let at = 0; at < count; at++) {
    form.phase = `Making ${at + 1} of ${count}`;
    form.progress = at / count + 0.1 / count;
    const attempt = await drawImage(plan, turn.signal);
    form.tiles.push({ value: attempt.id, src: attempt.src, alt: `${ask} ${at + 1}` });
    form.progress = (at + 1) / count;
    attempts.push(attempt);
  }

  const path = keepStill(attempts, ask, plan.still);
  form.phase = 'Done';
  await say(turn, `[Open in Photos](${linkTo('photos', path)}) or [see it large](${linkTo('preview', path)}).`);
}

/**
 * Keeps made images: as more attempts of a still, or as a new still in Photos.
 *
 * @param attempts - The images, the first of them shown.
 * @param prompt - What they were asked for.
 * @param still - The still they join, if any.
 * @returns The still's path.
 */
function keepStill(attempts: GeneratedAttempt[], prompt: string, still?: string): string {
  const existing = still ? documentAt<'still'>(still) : undefined;
  if (still && existing) {
    existing.attempts.push(...attempts);
    existing.chosen = attempts[0].id;
    return still;
  }
  const path = freePath(PHOTOS_ROOT, nameFrom(prompt), '.still');
  const document: StillDocument = {
    ...newHeader(path, '.still'),
    author: { kind: 'agent', ask: prompt },
    type: 'still',
    tags: [GENERATIVE],
    prompt,
    references: [],
    attempts,
    edits: [],
    chosen: attempts[0].id,
  };
  supply([[path, document]]);
  return path;
}

/** What a new motion goes through, each a step of its job. */
const MOTION_PHASES = ['Writing the script', 'Laying out the stage', 'Rendering a preview'];
/** How long each of them seems to take. */
const MOTION_STEP = STEP * 1.5;
/** What a motion is called when nothing was asked for. */
const NEW_MOTION = 'A new motion';

/**
 * Keeps a new motion, as Motions' options in the dock say, with a cover of its own.
 *
 * @param ask - What it's of.
 * @returns Its cover, and where it's kept.
 */
async function keepMotion(ask: string): Promise<{ cover: string; path: string }> {
  const cover = pictureFor(crypto.randomUUID(), animation.aspect);
  return { cover, path: (await newMotion(nameFrom(ask), animation.aspect, cover)).path };
}

/**
 * Makes a new motion as the agent would, saying so, phase by phase, and links to it.
 *
 * @param turn - The answer.
 * @param prompt - What to make.
 * @returns Once it's made.
 */
async function makeMotion(turn: Turn, prompt: string): Promise<void> {
  const ask = prompt || NEW_MOTION;
  const { aspect, model, seconds } = animation;
  await say(turn, `Starting a ${seconds} second motion: **${ask}**.`);
  add(turn, job(ask, `${MODELS.take[model]} · ${aspect} · ${seconds}s`, 'Cover'));

  const form = lastForm(turn);
  for (const [at, phase] of MOTION_PHASES.entries()) {
    form.phase = phase;
    form.progress = (at + 0.3) / MOTION_PHASES.length;
    await pause(MOTION_STEP, turn.signal);
    form.progress = (at + 1) / MOTION_PHASES.length;
  }

  const { cover, path } = await keepMotion(ask);
  form.tiles.push({ value: 'cover', src: cover, alt: ask });
  form.phase = 'Done';
  await say(turn, `It's in **${MOTIONS_ROOT.slice(2)}** as a draft. [Open it](${linkTo('motions', path)}).`);
}

/**
 * Something being made, reading its own state: its pictures so far, how far it's come, and what
 * it's doing now.
 *
 * @param title - What's being made.
 * @param detail - What it's made with.
 * @param label - Names its pictures.
 * @returns The widget.
 */
function job(title: string, detail: string, label: string): DockWidgetPart {
  return {
    type: 'widget',
    form: { phase: 'Starting', progress: 0, tiles: [] },
    children: [
      {
        role: 'card-header',
        children: [
          { role: 'card-title', children: [title] },
          { role: 'card-description', children: [detail] },
        ],
      },
      {
        role: 'card-body',
        children: [
          { role: 'gallery', props: { label }, bindings: [{ prop: 'items', state: '$this.form.tiles' }] },
          { role: 'progress', props: { size: 'sm', label: 'Progress', max: 1 }, bindings: [{ prop: 'value', state: '$this.form.progress' }] },
          { role: 'badge', bindings: [{ prop: 'children', state: '$this.form.phase' }] },
        ],
      },
    ],
  };
}

/**
 * Asks for what a meeting is missing, as a form whose submit is `system.calendar.createEvent`.
 *
 * @param turn - The answer.
 * @param text - What was asked, which its title starts from.
 * @returns Once it's asked.
 */
async function meeting(turn: Turn, text: string): Promise<void> {
  await say(turn, 'Sure. When and where should it be?');
  add(turn, {
    type: 'widget',
    form: { title: nameFrom(text), date: tomorrow(), time: '10:00', location: '' },
    formAction: 'system.calendar.createEvent',
    once: true,
    children: [
      { role: 'card-header', children: [{ role: 'card-title', children: ['New meeting'] }] },
      {
        role: 'card-body',
        children: [
          field('text-input', '$this.form.title', { label: 'Title', required: true }),
          field('date-picker', '$this.form.date', { label: 'Date', labels: DATE_LABELS }),
          field('time-picker', '$this.form.time', { label: 'Time', labels: TIME_LABELS }),
          field('text-input', '$this.form.location', { label: 'Location', placeholder: 'Where?' }),
        ],
      },
      { role: 'card-actions', children: [submit('Add meeting')] },
    ],
  });
}

/**
 * Asks before marking every unread message read, with one button for `system.mail.markAllRead`.
 *
 * @param turn - The answer.
 * @returns Once it's asked.
 */
async function askMarkRead(turn: Turn): Promise<void> {
  const unread = mailListing({ unread: true, keep: [] });
  if (!unread.length) return say(turn, 'Your inbox is already read.');
  const senders = unread.slice(0, 3).map((message) => nameOfPerson(message.from));
  add(turn, {
    type: 'widget',
    children: [
      {
        role: 'card-header',
        children: [
          { role: 'card-title', children: [`Mark ${unread.length} ${unread.length === 1 ? 'message' : 'messages'} as read?`] },
          { role: 'card-description', children: [senders.join(', ')] },
        ],
      },
      {
        role: 'card-actions',
        children: [
          {
            role: 'button',
            props: { size: 'sm', variant: 'filled', action: 'system.mail.markAllRead', once: true },
            children: ['Mark as read'],
          },
        ],
      },
    ],
  });
}

/**
 * Lists unread mail, each row linking to its message.
 *
 * @param turn - The answer.
 * @returns Once it's shown.
 */
async function showMail(turn: Turn): Promise<void> {
  const unread = mailListing({ unread: true, keep: [] });
  await say(turn, unread.length ? `You have ${unread.length} unread.` : 'Nothing unread.');
  if (!unread.length) return;
  add(
    turn,
    rows(
      'Unread',
      unread.slice(0, 4).map((message) => ({
        title: nameOfPerson(message.from),
        description: message.subject,
        meta: shortDate(message.date),
        href: linkTo('mail', message.path),
      }))
    )
  );
}

/**
 * The next few events.
 *
 * @returns Those from today on, soonest first.
 */
function comingUp() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return calendarListing({ view: 'calendar' })
    .filter((event) => new Date(event.start) >= today)
    .slice(0, 4);
}

/**
 * Sums up the user's day in words alone, each thing linking to where it lives.
 *
 * @param turn - The answer.
 * @returns Once it's said.
 */
async function brief(turn: Turn): Promise<void> {
  const unread = mailListing({ unread: true, keep: [] });
  const mail = unread.slice(0, 3).map((message) => `- **${nameOfPerson(message.from)}**: [${message.subject}](${linkTo('mail', message.path)})`);
  const coming = comingUp().map(
    (event) => `- [${event.summary}](${linkTo('calendar', event.path)}), ${event.allDay ? shortDate(event.start) : timeOf(event.start)}`
  );
  await say(
    turn,
    [
      `## Your day`,
      `You have **${unread.length} unread** and **${coming.length} things** coming up.`,
      `### Mail`,
      mail.join('\n'),
      `### Coming up`,
      coming.join('\n'),
      `The budget is the one I'd read first.`,
    ].join('\n\n')
  );
}

/**
 * Lists what's coming up, each row linking to its event.
 *
 * @param turn - The answer.
 * @returns Once it's shown.
 */
async function showSchedule(turn: Turn): Promise<void> {
  const coming = comingUp();
  await say(turn, coming.length ? "Here's what's coming up." : 'Nothing coming up.');
  if (!coming.length) return;
  add(
    turn,
    rows(
      'Coming up',
      coming.map((event) => ({
        title: event.summary,
        description: event.location ?? '',
        meta: event.allDay ? shortDate(event.start) : timeOf(event.start),
        href: linkTo('calendar', event.path),
      }))
    )
  );
}

/**
 * Lists the user's memos, each row linking to it.
 *
 * @param turn - The answer.
 * @returns Once it's shown.
 */
async function showMemos(turn: Turn): Promise<void> {
  await say(turn, 'Your memos, the ones that matter most first.');
  add(
    turn,
    rows(
      'Memos',
      memosOf('personal')
        .slice(0, 4)
        .map(({ path, document }) => ({ title: document.name, meta: shortDate(document.updated), href: linkTo('memo', path) }))
    )
  );
}

/**
 * A titled list of rows that each link somewhere.
 *
 * @param title - What the list is.
 * @param items - Its rows' props.
 * @returns The widget.
 */
function rows(title: string, items: Record<string, string>[]): DockWidgetPart {
  return {
    type: 'widget',
    children: [
      { role: 'card-header', children: [{ role: 'card-title', children: [title] }] },
      {
        role: 'card-body',
        children: [{ role: 'list', props: { label: title }, children: items.map((props) => ({ role: 'list-item', props })) }],
      },
    ],
  };
}

/**
 * An input editing a value of the widget it's in.
 *
 * @param role - Which input.
 * @param state - The value's path, from `$this`.
 * @param props - Its other props.
 * @returns The node.
 */
function field(role: string, state: string, props: Record<string, never> | object) {
  return {
    role,
    props: { size: 'sm', ...props },
    bindings: [{ prop: 'value', state, writable: true }],
  } as Exclude<WidgetNode, string>;
}

/**
 * A form's submit button.
 *
 * @param label - What it says.
 * @returns The node.
 */
function submit(label: string) {
  return { role: 'button', props: { size: 'sm', variant: 'filled', type: 'submit' }, children: [label] };
}

/**
 * What a prompt says, without what was picked into it.
 *
 * @param event - The sent prompt.
 * @returns Its own words.
 */
function promptText(event: PromptEvent | Event): string {
  const { text, selections } = event as PromptEvent;
  return selections.reduce((rest, { label }) => rest.replace(`/${label}`, '').replace(`@${label}`, ''), text).trim();
}

/**
 * Waits, unless cut off.
 *
 * @param duration - How long, in milliseconds.
 * @param signal - What cuts it off.
 * @returns Once it's waited; rejected when cut off.
 */
function pause(duration: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, duration);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

/**
 * A stand-in picture at an aspect ratio.
 *
 * @param seed - What makes it its own.
 * @param aspect - Its aspect ratio, e.g. `16:9`.
 * @returns Its address.
 */
function pictureFor(seed: string, aspect: string): string {
  const [width, height] = aspect.split(':').map(Number);
  const scale = 1024 / Math.max(width, height);
  return `https://picsum.photos/seed/${seed}/${Math.round(width * scale)}/${Math.round(height * scale)}`;
}

/**
 * A short name from what was asked: its first few words.
 *
 * @param text - What was asked.
 * @returns The name.
 */
function nameFrom(text: string): string {
  return (
    text
      .replace(/[/\\]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join(' ') || 'Untitled'
  );
}

/**
 * Tomorrow on the user's own calendar.
 *
 * @returns Its date, e.g. `2026-11-01`.
 */
function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * A time as a row shows it.
 *
 * @param iso - The moment, as an ISO date.
 * @returns E.g. `9:30 AM`.
 */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
