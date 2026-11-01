import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { confirmDialog } from '@/components/ConfirmHost.js';
import { AppGlyph, DeleteIcon, OpenIcon } from '@/components/icons.js';
import { SYSTEM } from './boot.js';
import type { CommandInput, Commands, PromptEvent } from './registry.js';

/**
 * Wedyan's own commands, at `system.name`: shortcuts for the user to things on the desktop. Asking
 * and reading need no command: a plain prompt is a question, and the agent reads what it needs to
 * answer it.
 */
export const COMMANDS: Commands = {
  open: { hint: 'Open an app', icon: <OpenIcon />, contexts: installedApps, handle: openApps },
  clear: {
    hint: 'Clear the chat',
    icon: <DeleteIcon />,
    handle: async ({ event }) => {
      const confirmed = await confirmDialog({
        title: 'Clear Chat',
        message: 'Are you sure you want to clear the chat? Anything still being answered stops.',
        action: 'Clear',
        color: 'error',
      });
      if (confirmed) await (event as PromptEvent).clearChat?.();
    },
  },
};

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
