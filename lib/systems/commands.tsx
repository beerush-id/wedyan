import type { DockSubmitEvent, DockSuggestion } from '@airlib/react-aui/desktop';
import { AppGlyph, NoteIcon, OpenIcon, RunIcon, SetIcon, SummarizeIcon } from '@/components/icons.js';
import { SYSTEM } from './boot.js';

/** A command for `/`; one that's about something in particular says what `@` offers after it. */
export type PromptCommand = DockSuggestion & {
  /** What `@` offers once this command comes before it, e.g. the apps after `/open`. */
  contexts?: () => DockSuggestion[];
};

/** The set the system's commands belong to, so the front window's follow after a gap. */
const SYSTEM_GROUP = 'system';

/**
 * What `/` always offers: the system's own verbs (run a tool, change a value), then what Wedyan
 * can do on request, mock until the system's tools are wired. Asking and reading need no command:
 * a plain prompt is a question, and the agent reads what it needs to answer it.
 */
export const COMMANDS: PromptCommand[] = [
  { value: 'run', label: 'run', hint: 'Run a tool', icon: <RunIcon /> },
  { value: 'set', label: 'set', hint: 'Change a value', icon: <SetIcon /> },
  { value: 'note', label: 'note', hint: 'Write a note', icon: <NoteIcon /> },
  {
    value: 'open',
    label: 'open',
    hint: 'Open an app',
    icon: <OpenIcon />,
    contexts: installedApps,
    action: openApps,
  },
  { value: 'summarize', label: 'summarize', hint: 'Sum up a file', icon: <SummarizeIcon /> },
].map((command) => ({ ...command, group: SYSTEM_GROUP }));

/**
 * `/open`'s action: launches each app picked after it, as the launcher would. With none picked,
 * there's nothing to open, so it fails and what's written stays.
 *
 * @param event - The sent prompt, with what was picked into it.
 * @returns Once every app has booted.
 */
async function openApps(event: DockSubmitEvent): Promise<void> {
  const names = event.references.filter((reference) => reference.char === '@').map((reference) => reference.item.value);
  const installed = names.filter((name) => SYSTEM?.system.apps?.some((app) => app.manifest.name === name));
  if (!installed.length) throw new Error('/open needs an app picked after it.');
  await Promise.all(installed.map((name) => SYSTEM?.launch(name)));
}

/**
 * The apps installed on the system, as things to open.
 *
 * @returns One suggestion per app.
 */
function installedApps(): DockSuggestion[] {
  return (SYSTEM?.system.apps ?? []).map((app) => ({
    value: app.manifest.name,
    label: app.manifest.label,
    icon: <AppGlyph />,
  }));
}
