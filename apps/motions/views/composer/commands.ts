import type { Commands } from '@/lib/systems/public.js';
import type { Composer } from './context.js';

/** How long, in ms, a command waits for the stage Compose is opening. */
const STAGE_WAIT = 3000;

/** How often, in ms, it looks. */
const STAGE_CHECK = 50;

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
        const named = String(form.stage).toLowerCase();
        const row = composer.stages.find(({ name, path }) => name.toLowerCase() === named || path === composer.pathOf(form.stage));
        if (!row) throw new Error(`There's no stage ${form.stage} in this project.`);
        Object.assign(composer, { activeView: 'stage', activeStage: row.path });
      },
    },
    selectClip: {
      does: 'Selects a clip on the stage open in Compose, which shows its properties.',
      takes: '{"clip": string} // its id',
      unlisted: true,
      handle: async ({ form }) => {
        const { tracks } = await composing(composer);
        for (const track of tracks) {
          for (const segment of track.segments) {
            if (segment.id === form.clip) return void Object.assign(composer, { clips: [form.clip], node: '' });
          }
        }
        throw new Error(`There's no clip ${form.clip} on this stage.`);
      },
    },
    play: {
      does: 'Plays the stage open in Compose.',
      unlisted: true,
      handle: async () => void (await composing(composer)).play(),
    },
    pause: {
      does: 'Pauses the stage open in Compose.',
      unlisted: true,
      handle: async () => void (await composing(composer)).pause(),
    },
    render: {
      does: 'Renders the stage open in Compose to a video, which the window shows as it goes. The file downloads to the user\'s computer when it\'s done, not to their drive, so there\'s nothing to look for or wait on.',
      unlisted: true,
      handle: async () => {
        await composing(composer);
        composer.render();
        if (!composer.rendering) throw new Error(composer.status);
      },
    },
  };
}

/**
 * The timeline of the stage open in Compose, once it's there: switching to Compose opens it a moment
 * later, so a command sent right after the switch waits for it.
 *
 * @param composer - The window's composer.
 * @returns The timeline.
 * @throws When no stage comes to be open in Compose.
 */
async function composing(composer: Composer): Promise<NonNullable<Composer['timeline']>> {
  for (let waited = 0; composer.mode === 'compose' && waited < STAGE_WAIT; waited += STAGE_CHECK) {
    if (composer.timeline) return composer.timeline;
    await new Promise((resolve) => setTimeout(resolve, STAGE_CHECK));
  }
  throw new Error('No stage is open in Compose.');
}
