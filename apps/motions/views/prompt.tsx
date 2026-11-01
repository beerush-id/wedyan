import { mutable } from '@airlib/react';
import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { confirmDialog } from '@/components/ConfirmHost.js';
import { DeleteIcon } from '@/components/icons.js';
import { rowsOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { linkTo } from '@/lib/systems/links.js';
import type { Commands } from '@/lib/systems/public.js';
import type { PromptEvent } from '@/lib/systems/registry.js';
import { openMotion } from './composer/index.js';
import { AddIcon, ProjectsIcon } from './icons.js';
import { PROJECTS } from './library/listing.js';
import { animation, destination, MOTION_FILE, newMotion, removeEntries, ROOT } from './motion.js';

/** What a request can mention while Motions is in front. */
export const CONTEXTS: DockSuggestion[] = [];

/** What `/new-motion` calls a motion when it's given no name. */
const NEW_MOTION = 'New motion';

/** The listing `@` reads after `/open-motion`, replaced whole as it's asked for again. */
const listed = mutable({ projects: undefined as ReturnType<typeof dfs.list> | undefined }, { recursive: false });

let listening = false;

/** What Motions can do, at `system.motions.name`. */
export const COMMANDS: Commands = {
  newMotion: {
    label: 'new-motion',
    hint: 'Make a motion',
    icon: <AddIcon />,
    handle: async ({ event }) => {
      const name = nameIn(event as PromptEvent);
      const { path } = await newMotion(name, animation.aspect, '', destination.folder);
      openMotion(path);
      return (
        <p>
          <strong>{name}</strong> is in Motions as a draft. <a href={linkTo('motions', path)}>Open it</a>.
        </p>
      );
    },
  },
  openMotion: {
    label: 'open-motion',
    hint: 'Open a motion',
    icon: <ProjectsIcon />,
    contexts: projects,
    handle: ({ event }) => {
      const picked = motionsIn(event as PromptEvent);
      if (!picked.length) return 'Pick a motion after /open-motion, with @.';
      for (const { value } of picked) openMotion(value);
      return (
        <p>
          Opened <strong>{namesOf(picked)}</strong>.
        </p>
      );
    },
  },
  deleteMotion: {
    label: 'delete-motion',
    hint: 'Delete a motion',
    icon: <DeleteIcon />,
    contexts: projects,
    handle: async ({ event }) => {
      const picked = motionsIn(event as PromptEvent);
      if (!picked.length) return 'Pick a motion after /delete-motion, with @.';
      const names = namesOf(picked);
      const confirmed = await confirmDialog({
        title: 'Delete Motion',
        message: `Are you sure you want to delete ${names}? It's taken off your drive.`,
        action: 'Delete',
        color: 'error',
      });
      if (confirmed) await removeEntries(picked.map(({ value }) => value));
      return (
        <p>
          {confirmed ? 'Deleted' : 'Kept'} <strong>{names}</strong>.
        </p>
      );
    },
  },
};

/**
 * The picked motions, as a line can name them.
 *
 * @param picked - What was picked.
 * @returns What they're called.
 */
function namesOf(picked: DockSuggestion[]): string {
  return picked.map(({ label }) => label).join(', ');
}

/**
 * The motions picked with `@` in a prompt.
 *
 * @param event - The sent prompt.
 * @returns What was picked, each with its `.motion` as its value.
 */
function motionsIn({ selections }: PromptEvent): DockSuggestion[] {
  return selections.filter((item) => item.type === 'motion');
}

/**
 * What the prompt names a new motion, with the command itself left out.
 *
 * @param event - The sent prompt.
 * @returns The name, or the name a motion has without one.
 */
function nameIn({ text, selections }: PromptEvent): string {
  return selections.reduce((rest, { label }) => rest.replace(`/${label}`, ''), text).trim() || NEW_MOTION;
}

/**
 * Every project, as `@` offers them after `/open-motion`. The listing is asked for the first time
 * they're wanted, and again as a project changes; what reads this only follows it.
 *
 * @returns The projects, each with its `.motion` as its value.
 */
function projects(): DockSuggestion[] {
  if (!listening) {
    listening = true;
    // Outside whoever's reading: a listing outlives what's drawn, and asking isn't a read.
    queueMicrotask(() => {
      listed.projects = dfs.list(ROOT, PROJECTS);
      dfs.watch(ROOT, ({ path }) => {
        if (MOTION_FILE.test(path)) listed.projects = dfs.list(ROOT, PROJECTS);
      });
    });
  }
  return rowsOf(listed.projects ?? {}).map(({ path, name, thumbnail }) => ({ type: 'motion', value: path, label: name, icon: thumbnail }));
}
