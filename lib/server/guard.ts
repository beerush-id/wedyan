import { GuardError, getContext, type IRPCSubRequest } from '@irpclib/irpc';
import { resolve } from '@irpclib/r2-file/path';
import { ACTOR_KEY, AGENT_ACTOR } from '@/lib/kernel/agent.js';

/**
 * Files only the user changes, through the desktop: the profile is every agent's persona, so an
 * agent writing it could steer every ask after it.
 */
export const USER_ONLY = ['~/profile.json'];

/** Files no agent may change or read: the user's secrets. */
export const SECRET = ['~/private.vault'];

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
    if (path && guarded.some((file) => within(file, path))) refuse(request.name, 'change');
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
