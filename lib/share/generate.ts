import { settingsOf } from '@/lib/documents/generation.js';
import type { SoundDocument, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import { type StillAttempt, type StillRequest, stillAttempts } from '@/lib/kernel/stills.h.js';
import { type SoundAttempt, soundAttempt } from '@/lib/speech/speech.h.js';
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

/**
 * Speaks a speech `.sound` a window here is editing, as a new attempt: its words, at their real
 * length, which is what a stage can be timed from before anything expensive is made.
 *
 * @param path - The sound's path in the home.
 * @returns The new attempt, in a list as every other way of making one gives it.
 * @throws When nothing on this desktop is editing that sound, or it has no words.
 */
export async function generateSpeech(path: string): Promise<SoundAttempt[]> {
  const sound = edited<SoundDocument>(path);
  if (!sound) throw new Error(`${path} isn't being edited on this desktop`);
  const text = sound.text?.trim();
  if (!text) throw new Error('Write the words it says first.');
  const attempt = await soundAttempt(path, text);
  addAttempts(sound as never, [attempt]);
  return [attempt];
}

/**
 * Generates a picture of a take a window here is editing, as a new attempt: one image, far cheaper
 * than a video, that plays in the take's clip for as long as the take runs, so what's asked can be
 * got right before a video is. It's chosen like any attempt, and a video replaces it the same way.
 *
 * @param path - The take's path in the home.
 * @returns The new attempts, each with an address to show it at.
 * @throws When nothing on this desktop is editing that take.
 */
export async function generateTakePicture(path: string): Promise<StillAttempt[]> {
  const take = edited<TakeDocument>(path);
  if (!take) throw new Error(`${path} isn't being edited on this desktop`);
  const { model, aspect, seconds } = settingsOf(take);
  const attempts = await stillAttempts(path, {
    prompt: take.prompt,
    settings: { model, aspect, batch: 1 },
    references: [...take.references],
    casts: [...(take.casts ?? [])],
  });
  addAttempts(take as never, attempts.map((attempt) => ({ ...attempt, seconds })));
  return attempts;
}
