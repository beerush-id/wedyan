import { GuardError, getContext, type IRPCSubRequest } from '@irpclib/irpc';
import { resolve } from '@irpclib/r2-file/path';
import { ACTOR_KEY, AGENT_ACTOR } from '@/lib/kernel/agent.js';
import { PROFILE_PATH, SETTINGS_PATH } from '@/lib/share/profile.js';
import { AGENTS_PATH, VAULT_PATH } from '@/lib/share/system.js';

/**
 * Files and folders only the user changes, through the desktop: the profile and settings are every
 * agent's persona, so an agent writing them could steer every ask after it; and an agent writing in
 * `~/Agents` could grant itself, or another, any skill.
 */
export const USER_ONLY = [PROFILE_PATH, SETTINGS_PATH, AGENTS_PATH];

/** Files no agent may change or read: the user's secrets. */
export const SECRET = [VAULT_PATH];

/**
 * Keeps agents off the user's own files. For an agent's call, it refuses one that would change a
 * protected file or a folder holding one (removing or moving `~` takes the profile with it), and
 * one that reads a secret file. Paths are compared as r2-file resolves them, so `~`, `..` and
 * absolute spellings of a protected file are all caught. The desktop's own calls pass untouched.
 *
 * @param request - The r2-file call about to run.
 */
export function guardAgentFiles(request: IRPCSubRequest): void {
  if (getContext<string>(ACTOR_KEY) !== AGENT_ACTOR) return;
  const args = ARGS[request.name];
  if (!args) return;

  const secret = SECRET.map(canonical);
  const guarded = [...USER_ONLY.map(canonical), ...secret];
  const pathAt = (index: number) =>
    typeof request.args[index] === 'string' ? canonical(request.args[index] as string) : undefined;

  for (const index of args.changed) {
    const path = pathAt(index);
    // Changing a protected file, anything inside a protected folder, or a folder holding either.
    if (path && guarded.some((file) => within(file, path) || within(path, file))) refuse(request.name, 'change');
  }
  for (const index of args.read ?? []) {
    const path = pathAt(index);
    if (path && secret.some((file) => within(path, file))) refuse(request.name, 'read');
  }
}

/**
 * Where each r2-file call takes its paths: the ones it changes, and the ones it only reads. A link
 * counts as changing its target, since writing through it would.
 */
const ARGS: Record<string, { changed: number[]; read?: number[] }> = {
  write: { changed: [0] },
  mkdir: { changed: [0] },
  remove: { changed: [0] },
  restore: { changed: [0] },
  move: { changed: [0, 1] },
  copy: { changed: [1], read: [0] },
  link: { changed: [0, 1] },
  read: { changed: [], read: [0] },
  stat: { changed: [], read: [0] },
  exists: { changed: [], read: [0] },
  list: { changed: [], read: [0] },
};

/** A path as r2-file resolves it for the current call: `~` expanded, relative paths and `..` settled. */
function canonical(path: string): string {
  return resolve('', path).path;
}

/** Whether `path` is `folder` itself or lies inside it. */
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder === '/' ? '' : folder}/`);
}

function refuse(name: string, access: 'change' | 'read'): never {
  throw GuardError.failed(`Permission denied: ${name} would ${access} a file only the user may ${access}`);
}
