import { $static, effect, mutable, Show, setup } from '@airlib/react';
import { defineWindow, isFrontWindow, Window, WindowBody } from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import { dfs } from '@/lib/share/dfs.js';
import type { FileRefEncoding } from '@/lib/share/workspace.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../../manifest.json';
import { documentAt } from '../motion.js';
import { CONTEXTS } from '../prompt.js';
import { Compose } from './compose/Compose.js';
import { ComposeDock, ComposeSubject } from './compose/Dock.js';
import { type ComposerData, composerCtx, createComposer } from './context.js';
import { Direct } from './direct/Direct.js';
import { DirectDock, DirectSubject } from './direct/Dock.js';
import { ComposerToolbar } from './Toolbar.js';

/** What the dock shows for the project window in front; that window says what. */
const MOTION_DOCK = mutable<{ extension?: FC; subject?: FC }>({ extension: undefined, subject: undefined }, { recursive: false });

const MotionDockExtension = setup(() => () => (MOTION_DOCK.extension ? <MOTION_DOCK.extension /> : null), 'MotionDockExtension');

const MotionDockSubject = setup(() => () => (MOTION_DOCK.subject ? <MOTION_DOCK.subject /> : null), 'MotionDockSubject');

/**
 * A project in a window of its own: Direct, its writing and everything around it, and Compose, a
 * stage put together. The view is one; each window is one project's data. The window holds the
 * composer every part reads, and hands the dock what's made in its scope.
 */
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
}).render((props) => {
  const instance = $static(() => props.instance);
  const { path, direct } = instance.data as ComposerData;
  const composer = createComposer(instance, path, direct);
  composerCtx.set(composer);

  // The dock sits outside the window, so what it shows is made here, reading this composer.
  const docked = (Part: FC) =>
    setup(() => {
      composerCtx.set(composer);
      return () => <Part />;
    }, 'Docked');
  const DOCK = {
    direct: { extension: docked(DirectDock), subject: docked(DirectSubject) },
    compose: { extension: docked(ComposeDock), subject: docked(ComposeSubject) },
  };
  effect(() => {
    if (isFrontWindow(instance)) Object.assign(MOTION_DOCK, DOCK[composer.mode]);
  });

  // What's open is what's edited: each of its files saves itself as it changes, bound once.
  const bound = new Set<string>();
  const bind = (file: string, encoding?: FileRefEncoding) => {
    if (bound.has(file)) return;
    bound.add(file);
    dfs.binding(file, { encoding });
  };
  effect(() => {
    const { motion } = composer;
    if (!motion) return;
    bind(path);
    if (motion.script) bind(composer.pathOf(motion.script.path), 'text');
    const generated = composer.generativeAsset();
    if (generated) bind(generated.path);
    if (composer.mode !== 'compose' && composer.activeView !== 'stage') return;
    const { stagePath, stage } = composer;
    if (stagePath) bind(stagePath);
    if (stage?.script) bind(composer.pathOf(stage.script), 'text');
  });

  return () => (
    <Window>
      <Window.Snippet for="body">
        {() => (
          <WindowBody className="wedyan-editor">
            <ComposerToolbar />
            <Show when={() => composer.motion}>
              {() => <Show when={() => composer.mode === 'direct'} fallback={() => <Compose />}>{() => <Direct />}</Show>}
            </Show>
          </WindowBody>
        )}
      </Window.Snippet>
    </Window>
  );
});

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

  return motionComposer.open({ path, direct } satisfies ComposerData, {
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
