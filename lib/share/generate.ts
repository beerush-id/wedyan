import type { StillDocument } from '@/lib/documents/types.js';
import { type StillAttempt, type StillRequest, stillAttempts } from '@/lib/kernel/stills.h.js';
import { addAttempts, applyRequest, requestOf } from './stills.js';
import { edited } from './workspace.js';

/**
 * Generates new attempts of a still a window here is editing, the way its Generate button does:
 * what's asked is written into the still, then its new attempts are made and added to it, so
 * they're saved with the window's own edits.
 *
 * @param path - The still's path in the home.
 * @param request - What to change before making it; leave it out to make more as it is.
 * @returns The new attempts, each with an address to show it at.
 * @throws When nothing on this desktop is editing that still: its attempts would be kept by no one.
 */
export async function generateStill(path: string, request?: Partial<StillRequest>): Promise<StillAttempt[]> {
  const still = edited<StillDocument>(path);
  if (!still) throw new Error(`${path} isn't being edited on this desktop`);
  if (request) applyRequest(still, request);
  const attempts = await stillAttempts(path, requestOf(still));
  addAttempts(still, attempts);
  return attempts;
}
