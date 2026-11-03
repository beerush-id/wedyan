import { settingsOf } from '@/lib/documents/generation.js';
import type { CastPictures, GeneratedAttempt, StillDocument } from '@/lib/documents/types.js';
import type { StillRequest } from '@/lib/kernel/stills.h.js';

// How a still is read and changed, the same on the desktop and the server: what it asks for, a
// request written into it, and new attempts added to it.

/**
 * What a still asks for now: its prompt, its settings with the defaults filled in, and its references.
 *
 * @param still - The still.
 * @returns Its request.
 */
export function requestOf(still: StillDocument): StillRequest {
  const { model, aspect, batch } = settingsOf(still);
  return {
    prompt: still.prompt,
    settings: { model, aspect, batch },
    references: [...(still.references ?? [])],
    casts: [...(still.casts ?? [])],
    castPictures: picturesOfCasts(still.castPictures),
    ...(still.describedAs ? { describedAs: still.describedAs } : {}),
  };
}

/**
 * Which of each cast's pictures a document asks for, as a plain copy to send.
 *
 * @param picked - What it holds.
 * @returns The copy.
 */
export function picturesOfCasts(picked: CastPictures = {}): CastPictures {
  return Object.fromEntries(Object.entries(picked).map(([cast, pictures]) => [cast, [...pictures]]));
}

/**
 * Writes what's asked into a still, so it says how its next attempts are made; what isn't asked
 * stays as it is.
 *
 * @param still - The still.
 * @param request - What to change.
 */
export function applyRequest(still: StillDocument, request: Partial<StillRequest>): void {
  if (request.prompt) still.prompt = request.prompt;
  const settings = Object.fromEntries(
    Object.entries(request.settings ?? {}).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(settings).length) still.settings = { ...still.settings, ...settings };
  if (request.references) still.references = [...request.references];
}

/**
 * Adds new attempts to a still's history and chooses the newest: what was just asked for is what
 * the still shows, with nothing more to pick.
 *
 * @param still - The still.
 * @param attempts - The new attempts, as made.
 */
export function addAttempts(still: StillDocument, attempts: Array<GeneratedAttempt & { url?: string }>): void {
  for (const { url: _, ...attempt } of attempts) still.attempts.push(attempt);
  const newest = attempts.at(-1);
  if (newest) still.chosen = newest.id;
}
