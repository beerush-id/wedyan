import type { WindowInstance } from '@airlib/react-aui/desktop';
import { SYSTEM } from '@/lib/systems/boot.js';
import { linkTo } from '@/lib/systems/links.js';
import { requestLink, runCommand } from '@/lib/systems/registry.js';

/** Registers an answer to what the server asks of the desktop, by name. */
type Answering = (name: string, handler: (args: never) => unknown) => unknown;

/**
 * Answers what the agent does on the desktop, once the words before it have been spoken: each action
 * runs through what the desktop already has, a launch or a link. The ones with nothing to run through
 * yet, `app.files.delete` and `app.motion.import`, stay unanswered.
 *
 * @param answer - What registers an answer, from `wedyan()`.
 */
export function answerActions(answer: Answering): void {
  answer('app.open', ({ app, file }: { app: string; file?: string }) => (file ? requestLink(linkTo(app, file)) : SYSTEM?.launch(app)));
  answer('app.mail.open', ({ path }: { path: string }) => requestLink(linkTo('mail', path)));
  answer('app.files.reveal', () => SYSTEM?.launch('files'));
  answer('app.photos.show', ({ paths }: { paths: string[] }) => Promise.all(paths.map((path) => requestLink(linkTo('photos', path)))));
  answer('desktop.tile', ({ apps }: { apps: string[] }) => {
    SYSTEM?.window.arrangeWindows('tile', document.querySelector<HTMLElement>('.aui-desktop'), windowsOf(apps));
  });
  answer('desktop.focus', ({ app }: { app: string }) => windowsOf([app]).at(-1)?.focus());
  answer('desktop.close', ({ window }: { window: string }) => SYSTEM?.windows.get(window)?.close());
  answer('window.run', async ({ window, command, args }: { window: string; command: string; args?: Record<string, unknown> }) => {
    const { signal } = new AbortController();
    await runCommand(`system.window[${window}].${command}`, { event: new Event('window.run'), signal, form: args ?? {} });
  });
}

/**
 * The open windows of some apps.
 *
 * @param apps - The apps, by name.
 * @returns Their windows, oldest first, an app's project windows among them.
 */
function windowsOf(apps: string[]): WindowInstance[] {
  return [...(SYSTEM?.windows.values() ?? [])].filter(({ app }) => apps.some((name) => app.name === name || app.name.startsWith(`${name}-`)));
}
