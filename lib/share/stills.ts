import { settingsOf } from '@/lib/documents/generation.js';
import type { GeneratedAttempt, StillDocument } from '@/lib/documents/types.js';
import { type StillAttempt, type StillRequest, stillAttempts } from '@/lib/kernel/stills.h.js';

/**
 * Generates new attempts of a still a window is editing, the way its Generate button does: what's
 * asked is written into the still, then its new attempts are made and added to it, so they're
 * saved with the window's own edits.
 *
 * @param still - The still, as the window edits it.
 * @param path - Its path in the home.
 * @param request - What to change before making it, if anything.
 * @returns The new attempts, each with an address to show it at.
 */
export async function generateStill(
  still: StillDocument,
  path: string,
  request?: Partial<StillRequest>,
): Promise<StillAttempt[]> {
  if (request) applyRequest(still, request);
  const attempts = await stillAttempts(path, requestOf(still));
  addAttempts(still, attempts);
  return attempts;
}

/**
 * What a still asks for now: its prompt, its settings with the defaults filled in, and its references.
 *
 * @param still - The still.
 * @returns Its request.
 */
export function requestOf(still: StillDocument): StillRequest {
  const { model, aspect, batch } = settingsOf(still);
  return { prompt: still.prompt, settings: { model, aspect, batch }, references: [...(still.references ?? [])] };
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
 * Adds new attempts to a still's history; the first becomes its chosen one when it has none yet,
 * otherwise the choice stays the user's.
 *
 * @param still - The still.
 * @param attempts - The new attempts, as made.
 */
export function addAttempts(still: StillDocument, attempts: Array<GeneratedAttempt & { url?: string }>): void {
  for (const { url: _, ...attempt } of attempts) still.attempts.push(attempt);
  if (!still.chosen && attempts.length) still.chosen = attempts[0].id;
}
