import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { AppGlyph, NoteIcon, OpenIcon, RunIcon, SetIcon, SummarizeIcon } from '@/components/icons.js';
import { askSummary, remember } from '@/lib/assistant/mock.js';
import { SYSTEM } from './boot.js';
import type { CommandHandle, CommandInput, Commands, PromptEvent } from './registry.js';

/**
 * Wedyan's own commands, at `system.name`: the system's verbs (run a tool, change a value), then
 * what Wedyan can do on request, mock until the system's tools are wired. Asking and reading need
 * no command: a plain prompt is a question, and the agent reads what it needs to answer it.
 */
export const COMMANDS: Commands = {
  run: { hint: 'Run a tool', icon: <RunIcon />, handle: notWired('run') },
  set: { hint: 'Change a value', icon: <SetIcon />, handle: notWired('set') },
  note: { hint: 'Write a note', icon: <NoteIcon />, handle: (input) => remember(input) },
  open: { hint: 'Open an app', icon: <OpenIcon />, contexts: installedApps, handle: openApps },
  summarize: { hint: 'Sum up a file', icon: <SummarizeIcon />, handle: (input) => askSummary(input) },
};

/**
 * A command waiting on the system's tools.
 *
 * @param name - The command's name.
 * @returns What it answers until then.
 */
function notWired(name: string): CommandHandle {
  return () => `/${name} isn't wired up yet.`;
}

/**
 * `/open`: launches each app picked after it, as the launcher would.
 *
 * @param input - The command's input, with the sent prompt.
 * @returns Once every app has booted, or what's missing.
 */
async function openApps({ event }: CommandInput): Promise<string | undefined> {
  const { selections } = event as PromptEvent;
  const names = selections.filter((item) => item.type === 'app').map((item) => item.value);
  const installed = names.filter((name) => SYSTEM?.system.apps?.some((app) => app.manifest.name === name));
  if (!installed.length) return 'Pick an app after /open, with @.';
  await Promise.all(installed.map((name) => SYSTEM?.launch(name)));
  return undefined;
}

/**
 * The apps installed on the system, as things to open.
 *
 * @returns One suggestion per app.
 */
function installedApps(): DockSuggestion[] {
  return (SYSTEM?.system.apps ?? []).map((app) => ({
    type: 'app',
    value: app.manifest.name,
    label: app.manifest.label,
    icon: <AppGlyph />,
  }));
}
