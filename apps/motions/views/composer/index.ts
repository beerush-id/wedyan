import { defineWindow } from '@airlib/react-aui/desktop';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../../manifest.json';
import { animation, documentAt } from '../motion.js';
import { CONTEXTS } from '../prompt.js';
import type { ComposerData } from './context.js';
import { ComposerWindow, MotionDockExtension, MotionDockSubject } from './Window.js';

/** The project window: one definition, a window for each project. */
export const motionComposer = defineWindow({
  name: `${manifest.name}-composer`,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 560, minHeight: 400 },
  multiple: true,
  dockExtensions: MotionDockExtension,
  dockSubject: MotionDockSubject,
}).render(ComposerWindow);

/**
 * Opens a project in a window of its own, or brings forward the one already showing it.
 *
 * @param path - The project's `.motion`.
 * @param direct - Whether it opens in Direct rather than Compose.
 * @returns The window showing the project.
 */
export function openMotion(path: string, direct = false) {
  const showing = motionComposer.instances.find((instance) => (instance.data as ComposerData).path === path);
  if (showing) {
    showing.focus();
    return showing;
  }

  return motionComposer.open({ path, direct, animation } satisfies ComposerData, {
    name: 'project',
    contexts: CONTEXTS,
    get title() {
      return documentAt<'motion'>(path)?.name ?? '';
    },
    get thumbnail() {
      return documentAt<'motion'>(path)?.cover;
    },
  });
}
