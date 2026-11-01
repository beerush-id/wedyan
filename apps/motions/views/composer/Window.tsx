import { effect, mutable, Show, setup, template } from '@airlib/react';
import { isFrontWindow, Window, WindowBody, type WindowRenderProps } from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import { dfs } from '@/lib/share/dfs.js';
import type { FileRefEncoding } from '@/lib/share/workspace.js';
import { attachCommands } from '@/lib/systems/public.js';
import { composerCommands } from './commands.js';
import { Compose } from './compose/Compose.js';
import { ComposeDock, ComposeSubject } from './compose/Dock.js';
import { type ComposerData, composerCtx, createComposer } from './context.js';
import { Direct } from './direct/Direct.js';
import { DirectDock, DirectSubject } from './direct/Dock.js';
import { ComposerToolbar } from './Toolbar.js';

/** What the dock shows for the project window in front; that window says what. */
const MOTION_DOCK = mutable<{ extension?: FC; subject?: FC }>({ extension: undefined, subject: undefined }, { recursive: false });

/** The options of the project window in front, in the dock. */
export const MotionDockExtension = template(() => (MOTION_DOCK.extension ? <MOTION_DOCK.extension /> : null), 'MotionDockExtension');

/** What those options act on, beside them. */
export const MotionDockSubject = template(() => (MOTION_DOCK.subject ? <MOTION_DOCK.subject /> : null), 'MotionDockSubject');

/**
 * A project in a window of its own: Direct, its writing and everything around it, and Compose, a
 * stage put together. The view is one; each window is one project's data. The window holds the
 * composer every part reads, and hands the dock what's made in its scope.
 *
 * @param props - The window's instance.
 * @returns The window's view.
 */
export function ComposerWindow({ instance }: WindowRenderProps) {
  const { path, direct } = instance.data as ComposerData;
  const composer = createComposer(path, direct);
  composerCtx.set(composer);
  attachCommands(instance, composerCommands(composer));

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
    const direct = composer.mode === 'direct';
    if (direct && composer.activeView === 'overview' && motion.script) bind(composer.pathOf(motion.script.path), 'text');
    const generated = composer.generativeAsset() ?? composer.generativeClip();
    if (generated) bind(generated.path);
    if (direct && composer.activeView !== 'stage') return;
    const { stagePath, stage } = composer;
    if (stagePath) bind(stagePath);
    if (direct && stage?.script) bind(composer.pathOf(stage.script), 'text');
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
}
