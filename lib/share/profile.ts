import { type PipeData, persistent } from '@irpclib/r2-file';
import type { Voice } from '../speech/speech.h.js';

/** Where the user's profile lives, in their home. Only the desktop writes it, never an agent. */
export const PROFILE_PATH = '~/profile.json';

/**
 * Who the user is and how the assistant behaves with them (`~/profile.json`). It holds no secrets;
 * those live in `~/private.vault`.
 */
export interface UserProfile {
  /** The name the user gave the assistant; "Wedyan" when they gave none. */
  assistantName?: string;
  /** How to call the user. */
  userName?: string;
  /** The voice the assistant speaks with; `DEFAULT_VOICE` until the user picks one. */
  voice?: Voice;
  /** How the assistant behaves, in the user's words. */
  persona?: string;
  /** Corrections the user asked for along the way, one per item. */
  refinements?: string[];
}

let profile: PipeData<UserProfile> | undefined;

/**
 * The user's profile as live state, for the desktop: read once, saved when it changes, and kept in
 * step with the user's other tabs. Every call shares the one state.
 *
 * @returns The profile's `{ ready, content }`.
 */
export function getProfile(): PipeData<UserProfile> {
  profile ??= persistent<UserProfile>(PROFILE_PATH, 'json');
  return profile;
}
