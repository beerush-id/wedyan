import type { Commands } from '@/lib/systems/public.js';
import type { Composer } from './context.js';

/**
 * What a project window lets agents do to what's on screen, so it follows the work as they speak.
 * They stay out of `/`: the user has the window's own controls. What a command can't do where the
 * window is now, it says, and the agent hears it.
 *
 * @param composer - The window's composer.
 * @returns Its commands, at `system.window[id].name`.
 */
export function composerCommands(composer: Composer): Commands {
  return {
    switchMode: {
      does: 'Switches the project between Direct, its script and everything around it, and Compose, a stage put together.',
      takes: '{"mode": "direct" | "compose"}',
      unlisted: true,
      handle: ({ form }) => {
        if (form.mode !== 'direct' && form.mode !== 'compose') throw new Error(`There's no ${form.mode} mode.`);
        composer.mode = form.mode;
      },
    },
    showStage: {
      does: 'Shows a stage of the project, in Direct or in Compose.',
      takes: '{"stage": string} // its name or its path',
      unlisted: true,
      handle: ({ form }) => {
        const row = composer.stages.find(({ name, path }) => name === form.stage || path === composer.pathOf(form.stage));
        if (!row) throw new Error(`There's no stage ${form.stage} in this project.`);
        Object.assign(composer, { activeView: 'stage', activeStage: row.path });
      },
    },
    selectClip: {
      does: 'Selects a clip on the stage open in Compose, which shows its properties.',
      takes: '{"clip": string} // its id',
      unlisted: true,
      handle: ({ form }) => {
        const clips = composing(composer).tracks.flatMap((track) => track.segments);
        if (!clips.some(({ id }) => id === form.clip)) throw new Error(`There's no clip ${form.clip} on this stage.`);
        Object.assign(composer, { clips: [form.clip], node: '' });
      },
    },
    play: {
      does: 'Plays the stage open in Compose.',
      unlisted: true,
      handle: () => void composing(composer).play(),
    },
    pause: {
      does: 'Pauses the stage open in Compose.',
      unlisted: true,
      handle: () => void composing(composer).pause(),
    },
    render: {
      does: 'Renders the stage open in Compose to a video file.',
      unlisted: true,
      handle: () => {
        composing(composer);
        composer.render();
        if (!composer.rendering) throw new Error(composer.status);
      },
    },
  };
}

/**
 * The timeline of the stage open in Compose, which only exists there.
 *
 * @param composer - The window's composer.
 * @returns The timeline.
 * @throws When no stage is open in Compose.
 */
function composing(composer: Composer): NonNullable<Composer['timeline']> {
  if (composer.mode !== 'compose' || !composer.timeline) throw new Error('No stage is open in Compose.');
  return composer.timeline;
}
