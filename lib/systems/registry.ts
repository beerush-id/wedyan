/*
 * What Wedyan's apps can do, and where it all goes: commands by name, links by scheme, and what the
 * desktop looks like right now. Everything reads the running system here, so an app never needs to.
 * The parts apps may use are in `public.ts`.
 */
import { type AnyType, snapshot } from '@airlib/react';
import { toast } from '@airlib/react-aui';
import type {
  AUIAppEntry,
  AUIOpenOptions,
  AUITools,
  DockSubmitEvent,
  DockSuggestion,
  DockWidgetEntry,
  WindowInstance,
} from '@airlib/react-aui/desktop';
import { newWidgetState, type WidgetContext, type WidgetState } from '@airlib/react-aui/dynamic';
import type { ReactNode } from 'react';
import { SYSTEM } from './boot.js';
import { COMMANDS } from './commands.js';

declare module '@airlib/react-aui/desktop' {
  /** What a Wedyan window opens with on top of what the shell needs. The shell never reads these. */
  interface AUIOpenOptions<D = AnyType, T extends AUITools = AUITools> {
    /** What it can do, at `system.window[id].name`, for as long as it's open. */
    commands?: Commands;
    /** What the prompt can mention while it's in front, e.g. its files. */
    contexts?: DockSuggestion[];
  }
}

/** What each open window was opened with, by id. The object itself, so a getter in it stays live. */
const opened = new Map<string, Omit<AUIOpenOptions, 'data'>>();

/**
 * Records what a widget came to: the owner of the conversation overwrites its form with `data` and
 * settles it. What a command draws isn't part of it: only what's acknowledged is remembered.
 *
 * @param widgetId - The server's id for the widget.
 * @param data - The values to keep, which the agent sees next turn.
 */
export type WidgetAck = (widgetId: string, data: WidgetState['form']) => void | Promise<void>;

/** What a command is called with. */
export type CommandInput = {
  /** What triggered it: the sent prompt, or the press. */
  event: PromptEvent | Event;
  /** The live values of the widget it came from, to read and change; empty from the prompt. */
  form: WidgetState['form'];
  /** The live state of the widget it came from: set `disabled` to lock it. */
  ctx: WidgetContext;
  /** Aborted when the user stops it. */
  signal: AbortSignal;
  /** The widget it came from; none from the prompt. */
  widget?: DockWidgetEntry;
  /** The server's id of the widget it came from, for `ack`. */
  widgetId?: string;
  /** Records what the widget came to; none from the prompt. */
  ack?: WidgetAck;
};

/**
 * What a command does. The widget is only wiring: whatever a command needs — a check, a confirm
 * before something destructive — is its own to do. It's code, so its result is what it draws.
 */
export type CommandHandle = (input: CommandInput) => ReactNode | Promise<ReactNode | void> | void;

/** A command that offers itself in `/`, with how it shows there. */
export type CommandEntry = {
  /** What `/` shows and puts in; its key without one. */
  label?: string;
  /** A quieter word at the end of its row. */
  hint?: string;
  /** Its glyph, or a picture's URL. */
  icon?: string | ReactNode;
  /** What `@` offers once this command comes before it, e.g. the apps after `/open`. */
  contexts?: () => DockSuggestion[];
  /** What it does, as an agent reads it; only a command with this is offered to agents. */
  does?: string;
  /** What it takes in `form`, as an agent reads it, e.g. `{"stage": string}`. */
  takes?: string;
  /** Leaves it out of `/`: a window's command is mostly a bridge for agents, not something the user runs. */
  unlisted?: boolean;
  handle: CommandHandle;
};

/** A command: a bare function, which `/` leaves out, or an entry, which it offers. */
export type Command = CommandHandle | CommandEntry;

/** Commands by name, within the scope that registers them. */
export type Commands = Record<string, Command>;

/**
 * Opens a link of a scheme the app claims.
 *
 * @param link - The whole link, e.g. `mail:/Mail/m1.eml`.
 */
export type LinkHandle = (link: string) => void | Promise<void>;

/** An installed app: what the shell needs, and what it can do. */
export type WedyanApp = AUIAppEntry & {
  /** What it can do with no window open, at `system.[app].name`. */
  commands?: Commands;
  /** The link schemes it opens, e.g. `{ mail: (link) => … }`. */
  linkHandle?: Record<string, LinkHandle>;
};

/** A command as an agent reads it. */
export type AgentCommand = { name: string; does: string; takes?: string };

/** A window as anything outside the system sees it: plain data, nothing to reach back in through. */
export type WindowFacts = {
  id: string;
  app: string;
  name?: string;
  title: string;
  data?: unknown;
  commands?: AgentCommand[];
};

/** What the desktop looks like at a moment, as plain data, for what a request is about. */
export type PromptContext = {
  activeWindow?: WindowFacts;
  openWindows: WindowFacts[];
  apps: { name: string; label: string }[];
  /** Every command that can be run, by its full name. */
  commands: string[];
  /** The link schemes apps claim. */
  links: string[];
};

/** A sent prompt, with what Wedyan knows about it. */
export type PromptEvent = DockSubmitEvent & {
  context: PromptContext;
  /** Runs the command picked into it, when there is one. */
  command?: () => Promise<ReactNode>;
  /** Starts the conversation over. */
  clearChat?: () => Promise<unknown>;
};

/** A `/` suggestion: a command, by its full name. */
export type CommandSuggestion = DockSuggestion & { type: 'command'; name: string; contexts?: () => DockSuggestion[] };

/**
 * Runs a command by name. A name nothing answers to throws, as a failing command does, so whoever
 * asked shows it the same way; so does being stopped, as an `AbortError`.
 *
 * @param name - The command's name, e.g. `system.mail.deleteAll`.
 * @param input - What it's called with; `form` and `ctx` start empty without a widget.
 * @returns What the command drew.
 */
export async function runCommand(
  name: string,
  input: Pick<CommandInput, 'event' | 'signal'> & Partial<CommandInput>,
): Promise<ReactNode> {
  const handle = handleOf(commandAt(name));
  if (!handle) throw new Error(`${name} isn't registered.`);
  const result = await handle({ ...newWidgetState(), ...input });
  input.signal.throwIfAborted();
  return result as never;
}

/**
 * Keeps what a new window was opened with, for as long as it's open.
 *
 * @param win - The window.
 * @param options - What it was opened with.
 */
export function keepWindow(win: WindowInstance, options: Omit<AUIOpenOptions, 'data'>): void {
  opened.set(win.id, options);
}

/**
 * Gives an open window what it can do, for as long as it's open. A window attaches them itself, from
 * inside, because they act on what only it holds.
 *
 * @param win - The window.
 * @param commands - Its commands, at `system.window[id].name`.
 */
export function attachCommands(win: WindowInstance, commands: Commands): void {
  const options = opened.get(win.id);
  if (options) options.commands = commands;
}

/**
 * Lets go of a closed window.
 *
 * @param win - The window.
 */
export function dropWindow(win: WindowInstance): void {
  opened.delete(win.id);
}

/**
 * What the front window lets a request mention.
 *
 * @returns What `@` offers there; nothing with no window in front.
 */
export function windowContexts(): DockSuggestion[] {
  const front = SYSTEM?.activeWindow;
  return (front && opened.get(front.id)?.contexts) ?? [];
}

/**
 * What `/` offers, nearest what the user is on first: the front window's, every installed app's with
 * the front app's first, then Wedyan's own, each as a set of its own. A command offers itself by
 * being an object; a bare function stays callable but out of the list.
 *
 * @returns The commands to suggest.
 */
export function commandSuggestions(): CommandSuggestion[] {
  const front = SYSTEM?.activeWindow;
  const app = front && appNamed(front.app.name);
  const apps = app ? [app, ...installedApps().filter((each) => each !== app)] : installedApps();
  return [
    ...offered(front && opened.get(front.id)?.commands, `system.window[${front?.id}]`, front?.title ?? ''),
    ...apps.flatMap(({ manifest, commands }) => offered(commands, `system.${manifest.name}`, manifest.label)),
    ...offered(COMMANDS, 'system', 'Wedyan'),
  ];
}

/**
 * The desktop right now, as plain data.
 *
 * @returns What's open, what's installed, and what can be asked for.
 */
export function promptContext(): PromptContext {
  const apps = installedApps();
  const windows = [...(SYSTEM?.windows.values() ?? [])];
  return {
    activeWindow: SYSTEM?.activeWindow && factsOf(SYSTEM.activeWindow),
    openWindows: windows.map(factsOf),
    apps: apps.map(({ manifest }) => ({ name: manifest.name, label: manifest.label })),
    commands: [
      ...Object.keys(COMMANDS).map((key) => `system.${key}`),
      ...apps.flatMap((app) => Object.keys(app.commands ?? {}).map((key) => `system.${app.manifest.name}.${key}`)),
      ...windows.flatMap((each) =>
        Object.keys(opened.get(each.id)?.commands ?? {}).map((key) => `system.window[${each.id}].${key}`),
      ),
    ],
    links: apps.flatMap((app) => Object.keys(app.linkHandle ?? {})),
  };
}

/**
 * Asks for a link to be opened: the app that claims its scheme opens it, e.g. `mail:/Mail/m1.eml`.
 * A link nothing claims says so in a toast.
 *
 * @param link - The link.
 * @returns Once it's handled.
 */
export async function requestLink(link: string): Promise<void> {
  const handle = linkHandleOf(schemeOf(link));
  if (!handle) {
    toast.error('Nothing can open this link');
    return;
  }
  await handle(link);
}

/**
 * Whether a link is Wedyan's to open rather than the browser's: a path, or a scheme an app claims.
 * Anything else, like a web link no app claims, stays the browser's.
 *
 * @param link - The link.
 * @returns True when `requestLink` should take it.
 */
export function isAppLink(link: string): boolean {
  if (link.startsWith('#')) return false;
  const scheme = schemeOf(link);
  return !scheme || !!linkHandleOf(scheme);
}

/**
 * The installed apps.
 *
 * @returns Each, as Wedyan knows it.
 */
function installedApps(): WedyanApp[] {
  return (SYSTEM?.system.apps ?? []) as WedyanApp[];
}

/**
 * An installed app.
 *
 * @param name - Its manifest's name.
 * @returns The app, if it's installed.
 */
function appNamed(name: string): WedyanApp | undefined {
  return installedApps().find((app) => app.manifest.name === name);
}

/**
 * The command at a name, from Wedyan's own, an installed app's, or an open window's.
 *
 * @param name - E.g. `system.note`, `system.mail.deleteAll`, or `system.window[window-mail-1].rename`.
 * @returns The command, or undefined when nothing answers to the name.
 */
function commandAt(name: string): Command | undefined {
  const inWindow = /^system\.window\[(.+)\]\.(.+)$/.exec(name);
  if (inWindow) return opened.get(inWindow[1])?.commands?.[inWindow[2]];

  const [root, ...steps] = name.split('.');
  if (root !== 'system') return undefined;
  if (steps.length === 2) return appNamed(steps[0])?.commands?.[steps[1]];
  return steps.length === 1 ? COMMANDS[steps[0]] : undefined;
}

/**
 * The function a command runs.
 *
 * @param command - The command: a function, or an object holding one.
 * @returns The function, if there's a command.
 */
function handleOf(command?: Command): CommandHandle | undefined {
  return typeof command === 'function' ? command : command?.handle;
}

/**
 * The commands of one scope that offer themselves to `/`.
 *
 * @param commands - The scope's commands.
 * @param prefix - What their names start with.
 * @param group - The set they show as.
 * @returns Their suggestions.
 */
function offered(commands: Commands | undefined, prefix: string, group: string): CommandSuggestion[] {
  return Object.entries(commands ?? {}).flatMap(([key, command]) => {
    if (typeof command === 'function' || command.unlisted) return [];
    const { handle: _, ...entry } = command;
    const name = `${prefix}.${key}`;
    return [{ ...entry, type: 'command' as const, name, value: name, label: command.label ?? key, group }];
  });
}

/**
 * A window as plain data.
 *
 * @param instance - The window.
 * @returns What's known about it.
 */
function factsOf(instance: WindowInstance): WindowFacts {
  const { id, app, name, title, data } = instance;
  const commands = agentCommands(opened.get(id)?.commands);
  return { id, app: app.name, name, title, data: data && snapshot(data), ...(commands.length ? { commands } : {}) };
}

/**
 * The commands of a scope that agents can run.
 *
 * @param commands - The scope's commands.
 * @returns Each one that says what it does.
 */
function agentCommands(commands: Commands | undefined): AgentCommand[] {
  return Object.entries(commands ?? {}).flatMap(([name, command]) =>
    typeof command !== 'function' && command.does
      ? [{ name, does: command.does, ...(command.takes ? { takes: command.takes } : {}) }]
      : [],
  );
}

/**
 * A link's scheme.
 *
 * @param link - The link.
 * @returns The scheme in lower case, or undefined for a plain path.
 */
function schemeOf(link: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(link)?.[1].toLowerCase();
}

/**
 * The handler for a scheme. Two apps claiming one is reported, and the first installed keeps it.
 *
 * @param scheme - The scheme.
 * @returns Its handler, or undefined when no app claims it.
 */
function linkHandleOf(scheme?: string): LinkHandle | undefined {
  if (!scheme) return undefined;
  const claims = installedApps().filter((app) => app.linkHandle?.[scheme]);
  if (claims.length > 1)
    console.warn(`[Wedyan] "${scheme}:" links are claimed by more than one app; the first keeps them.`);
  return claims[0]?.linkHandle?.[scheme];
}
