import { PROFILE_PATH, SETTINGS_PATH } from './profile.js';

/** The user's conversation with Wedyan: its current page. Older pages are numbered beside it. */
export const CONVERSATION_PATH = '~/Desktop.chat';

/** Where the memories the assistant saved are kept, one `.memo` each. */
export const MEMOS_PATH = '~/Memos';

/** The user's secrets: never readable by agents. */
export const VAULT_PATH = '~/private.vault';

/** The user's own agents, one `.agent` each: only the user changes them, never an agent. */
export const AGENTS_PATH = '~/Agents';

/**
 * Where what comes from outside lands, one file per thing, written as it arrives: mail, calendar
 * invites, order receipts. What lands in them while the user is away is what they are briefed on.
 */
export const INBOXES = ['~/Mail', '~/Calendar', '~/Orders'] as const;

/**
 * Who writes a system file or folder: Wedyan's server (agents included), the desktop on the user's
 * behalf, or outside services as things arrive.
 */
export type SystemWriter = 'wedyan' | 'desktop' | 'services';

/** A file or folder the system controls, and what the desktop needs to show it for what it is. */
export type SystemEntry = {
  path: string;
  kind: 'file' | 'folder';
  /** What it holds, in a few words. */
  holds: string;
  writers: SystemWriter[];
};

/**
 * Every file and folder the system controls in the user's home, for the desktop to show as the
 * system's (an icon, a label, no rename or move). Paths are home-relative; `{n}` is a page number.
 */
export const SYSTEM_FILES: SystemEntry[] = [
  { path: CONVERSATION_PATH, kind: 'file', holds: 'The conversation with Wedyan', writers: ['wedyan'] },
  { path: '~/Desktop.{n}.chat', kind: 'file', holds: 'An older page of the conversation', writers: ['wedyan'] },
  { path: PROFILE_PATH, kind: 'file', holds: 'Who the user is', writers: ['desktop'] },
  { path: SETTINGS_PATH, kind: 'file', holds: 'How the assistant works with the user', writers: ['desktop'] },
  { path: MEMOS_PATH, kind: 'folder', holds: 'What the assistant remembers', writers: ['wedyan', 'desktop'] },
  { path: VAULT_PATH, kind: 'file', holds: 'The user’s secrets', writers: ['desktop'] },
  { path: AGENTS_PATH, kind: 'folder', holds: 'The user’s own agents, one file each', writers: ['desktop'] },
  { path: INBOXES[0], kind: 'folder', holds: 'Mail, one file each', writers: ['services'] },
  { path: INBOXES[1], kind: 'folder', holds: 'Calendar events and invites, one file each', writers: ['services'] },
  { path: INBOXES[2], kind: 'folder', holds: 'Order receipts, one file each', writers: ['services'] },
];

/**
 * Whether a path is one the system controls.
 *
 * @param path - The path, in the home.
 * @param kind - Whether it's a file or a folder.
 * @returns Whether `SYSTEM_FILES` lists it; `{n}` is a page number.
 */
export function isSystemPath(path: string, kind: SystemEntry['kind']): boolean {
  return SYSTEM_FILES.some((entry) => {
    if (entry.kind !== kind) return false;
    const [before, after] = entry.path.split('{n}');
    return after === undefined ? path === before : path.startsWith(before) && path.endsWith(after);
  });
}
