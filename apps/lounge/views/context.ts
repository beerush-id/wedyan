import { mutable, onCleanup, untrack } from '@airlib/react';
import { confirmDialog } from '@/components/ConfirmHost.js';
import { nameOf, parentOf } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import { LOUNGE, LOUNGE_EVENT } from '@/lib/kernel/workspace.h.js';
import { AGENT_EXTENSION } from '@/lib/share/agents.js';
import { dfs } from '@/lib/share/dfs.js';
import { byName, LISTINGS, newAgent, newPerson, PERSONA_EXTENSION, removeFile } from './library.js';
import type { PersonTab } from './session.js';

/** Who Lounge shows: the people and characters, or the user's own agents. */
export type Group = 'people' | 'agents';

/** One Lounge window, for every part of it. */
export type Lounge = ReturnType<typeof createLounge>;

/** Each group's file: where it lives, what it ends with, how one is made, and what deleting one says. */
const GROUPS: Record<Group, { folder: string; extension: string; create: () => Promise<string>; unnamed: string; removal: string }> = {
  people: {
    folder: LISTINGS.people[0],
    extension: PERSONA_EXTENSION,
    create: newPerson,
    unnamed: 'this person',
    removal: 'They’re taken off People. Their pictures stay in their folder.',
  },
  agents: {
    folder: LISTINGS.agents[0],
    extension: AGENT_EXTENSION,
    create: newAgent,
    unnamed: 'this agent',
    removal: 'It’s taken off Agents, and Wedyan stops handing it work.',
  },
};

/** What the open window lists, for what reads it from outside: the prompt's mentions. */
export const shown: { lounge?: Lounge } = {};

/**
 * A Lounge window's one source of truth: its state, and the real listing of each group, which
 * follows what's added, renamed or removed anywhere in the session.
 *
 * @returns The window's library.
 */
export function createLounge() {
  const state = mutable({
    group: 'people' as Group,
    tab: 'profile' as PersonTab,
    // Each group keeps its own pick; until the user picks, its first one is open.
    picked: { people: null, agents: null } as Record<Group, string | null>,
    query: '',
    sidebar: true,
    /** Whether a new one is on its way, so it's only made once. */
    creating: false,
    /** Read by each listing, which is asked for again as it changes: after a failure, or for what nobody here holds. */
    asked: { people: 0, agents: 0 } as Record<Group, number>,
  });

  const listings = {
    people: dfs.list.with(() => {
      void state.asked.people;
      return LISTINGS.people;
    }),
    agents: dfs.list.with(() => {
      void state.asked.agents;
      return LISTINGS.agents;
    }),
  };

  /** Takes rows out of the listings, and whatever was open among them goes with them. */
  const drop = (paths: string[]) => {
    for (const group of Object.keys(GROUPS) as Group[]) {
      const rows = rowsOf(listings[group]);
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (paths.includes(rows[index].path)) rows.splice(index, 1);
      }
      if (paths.includes(state.picked[group] as string)) state.picked[group] = null;
    }
  };

  /** A group's rows in name order: settled by the listing, so typing a name moves nothing. */
  const rows = (group: Group = state.group): FileRow[] => {
    const listed = rowsOf(listings[group]);
    return listed.length ? untrack(() => byName(listed)) : listed;
  };

  /** The one open beside the list: the group's pick, or its first. */
  const opened = (): string | null => state.picked[state.group] ?? rows()[0]?.path ?? null;

  LOUNGE.subscribe((event) => {
    if (event.type === LOUNGE_EVENT.RENAMED) {
      for (const group of Object.keys(GROUPS) as Group[]) {
        const row = rowsOf(listings[group]).find(({ path }) => path === event.data.path);
        if (row) row.name = event.data.title;
      }
    } else if (event.type === LOUNGE_EVENT.PORTRAIT) {
      const row = rowsOf(listings.people).find(({ path }) => path === event.data.path);
      if (row) row.thumbnail = event.data.thumbnail;
    } else if (event.type === LOUNGE_EVENT.REMOVED) {
      drop(event.data);
    }
  });

  // An agent's work and other desktops: what's gone goes, and what isn't here is asked for.
  for (const group of Object.keys(GROUPS) as Group[]) {
    const { folder, extension } = GROUPS[group];
    dfs.watch(folder, ({ path, removed }) => {
      if (removed) drop([path]);
      else if (parentOf(path) === folder && nameOf(path).endsWith(extension) && !rowsOf(listings[group]).some((row) => row.path === path)) {
        state.asked[group] += 1;
      }
    });
  }

  const lounge = {
    state,
    listings,
    rows,
    opened,

    /** The open one's row, once it's listed. */
    get row() {
      const path = opened();
      return rowsOf(listings[state.group]).find((row) => row.path === path);
    },

    /** Makes a new one in the group it's in and opens it; the listing hears of it as it does of any new file. */
    async create() {
      if (state.creating) return;
      state.creating = true;
      const { group } = state;
      try {
        state.picked[group] = await GROUPS[group].create();
      } finally {
        state.creating = false;
      }
    },

    /** Deletes the open one, once the user confirms; the group's first opens in its place. */
    async remove() {
      const path = opened();
      if (!path) return;
      const { unnamed, removal } = GROUPS[state.group];
      const confirmed = await confirmDialog({
        title: `Delete ${lounge.row?.name || unnamed}?`,
        message: removal,
        action: 'Delete',
        color: 'error',
      });
      if (!confirmed) return;
      // Closed first: an editor still open would write the file back.
      drop([path]);
      await removeFile(path);
    },
  };

  shown.lounge = lounge;
  onCleanup(() => {
    if (shown.lounge === lounge) shown.lounge = undefined;
  });

  return lounge;
}
