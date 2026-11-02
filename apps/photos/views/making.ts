import { mutable } from '@airlib/react';
import { chosenAttempt } from '@/lib/documents/generation.js';
import { newHeader, newId } from '@/lib/documents/paths.js';
import type { StillDocument } from '@/lib/documents/types.js';
import { type StillAttempt, type StillRequest, stillAttempts } from '@/lib/kernel/stills.h.js';
import { LOUNGE } from '@/lib/kernel/workspace.h.js';
import { dfs } from '@/lib/share/dfs.js';
import { documentAt } from '@/lib/share/documents.js';
import { addAttempts } from '@/lib/share/stills.js';
import { ROOTS } from './listing.js';

/** A picture a new image starts from, as the dock shows it. */
export type Reference = { path: string; name: string; picture: string };

/** A still being made again: whether it's on its way, and why it failed when it did. */
export type Making = { busy: boolean; error?: string };

/** What a new still is called before it's asked for anything. */
const NEW_STILL = 'New still';

/** The most references `still.attempts` takes. */
export const MAX_REFERENCES = 8;

/** The lounge message saying a still shows another picture: writes of a held file tell no one. */
export const STILL_CHANGED = 'still-changed';

/** How a new image is made: set from the dock, read when a prompt is sent. References last for the next one. */
export const generation = mutable({ model: 'standard', aspect: '1:1', batch: 1, references: [] as Reference[] });

/** Where a new still goes: set by the browser as it moves, read by whatever makes one. */
export const destination = mutable({ folder: ROOTS.photos });

/** What's being made of each still, by path, for its window to show, whoever asked. */
export const making = mutable<Record<string, Making>>({});

/**
 * What a new image is asked for: the prompt, and how the dock says to make it.
 *
 * @param prompt - What to make.
 * @param mentioned - Pictures named in the prompt, by path, on top of the dock's references.
 * @returns The request.
 */
export function dockRequest(prompt: string, mentioned: string[] = []): StillRequest {
  const { model, aspect, batch, references } = generation;
  return {
    prompt,
    settings: { model, aspect, batch },
    references: [...references.map(({ path }) => path), ...mentioned].slice(0, MAX_REFERENCES),
  };
}

/**
 * Starts an empty still project, to write its prompt in its window.
 *
 * @param folder - The folder it goes in.
 * @returns Its path, once it's written.
 */
export async function startStill(folder: string): Promise<string> {
  const path = pathIn(folder);
  const { prompt, settings } = dockRequest('');
  await dfs.write(path, stillAt(path, NEW_STILL, { prompt, settings }) as never);
  return path;
}

/**
 * Makes a new still from a request: its first attempts, then the document holding them, so it
 * arrives in Photos with its picture, and a request that made nothing leaves nothing behind.
 * `dfs.still.generate` works on a still a window holds; there's none yet, so this asks the kernel.
 *
 * @param folder - The folder it goes in.
 * @param name - What it's called.
 * @param request - What to make.
 * @returns Its path, or none when no image came back.
 */
export async function makeStill(folder: string, name: string, request: StillRequest): Promise<string | undefined> {
  const path = pathIn(folder);
  const attempts = await stillAttempts(path, request);
  if (!attempts.length) return;
  const still = stillAt(path, name, request);
  addAttempts(still, attempts);
  await dfs.write(path, still as never);
  return path;
}

/**
 * Makes new attempts of a still its window holds, one request at a time. What it comes to is in
 * `making`, for the window to show.
 *
 * @param path - The still's path.
 * @param request - What to change before making it; leave it out to make more as it is.
 * @returns The new attempts; none when nothing was made.
 */
export async function makeAttempts(path: string, request?: Partial<StillRequest>): Promise<StillAttempt[]> {
  if (making[path]?.busy) return [];
  if (!(request?.prompt ?? documentAt<'still'>(path)?.prompt)?.trim()) {
    making[path] = { busy: false, error: 'Write what to make first.' };
    return [];
  }
  making[path] = { busy: true };
  try {
    const attempts = await dfs.still.generate(path, request);
    if (!attempts.length) throw new Error('No image came back from the model.');
    const still = documentAt<'still'>(path);
    if (still) stillChanged(path, still);
    delete making[path];
    return attempts;
  } catch (error) {
    making[path] = { busy: false, error: (error as Error).message };
    return [];
  }
}

/**
 * Says a still shows another picture, to every Photos window on every desktop: the list of files
 * reads a still's picture from its row, and a held file's save reaches no one.
 *
 * @param path - The still's path.
 * @param still - The still.
 */
export function stillChanged(path: string, still: StillDocument): void {
  still.updated = new Date().toISOString();
  const message = { type: STILL_CHANGED, data: { path, picture: chosenAttempt(still)?.src, updated: still.updated } };
  LOUNGE.ask(message);
  LOUNGE.broadcast(message);
}

/** A new still's path: named by its id, so what it's called can change. */
function pathIn(folder: string): string {
  return `${folder}/${newId()}.still`;
}

/** A new still document, asking what's asked, with nothing made yet. */
function stillAt(path: string, name: string, request: StillRequest): StillDocument {
  return {
    ...newHeader(path, '.still'),
    type: 'still',
    name,
    prompt: request.prompt,
    settings: request.settings,
    references: request.references ?? [],
    attempts: [],
    edits: [],
    chosen: '',
  };
}
