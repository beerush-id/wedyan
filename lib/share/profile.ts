import { type PipeData, persistent } from '@irpclib/r2-file';
import type { Voice } from '../speech/speech.h.js';

/** Where the user's profile lives, in their home. Only the desktop writes it, never an agent. */
export const PROFILE_PATH = '~/profile.json';

/** Where the assistant's settings live, in the user's home. Only the desktop writes them, never an agent. */
export const SETTINGS_PATH = '~/settings.json';

/** Who the user is (`~/profile.json`). It holds no secrets; those live in `~/private.vault`. */
export interface UserProfile {
  /** How to call the user. */
  userName?: string;
}

/** How the assistant works with the user (`~/settings.json`). */
export interface UserSettings {
  /** The name the user gave the assistant; "Wedyan" when they gave none. */
  assistantName?: string;
  /** The voice the assistant speaks with; `DEFAULT_VOICE` until the user picks one. */
  voice?: Voice;
  /** How fast it speaks, as a multiple of the voice's own pace; `SPEECH_RATE` when unset. */
  speechRate?: number;
  /** How the assistant behaves, in the user's words. */
  persona?: string;
  /** Corrections the user asked for along the way, one per item. */
  refinements?: string[];
  /** How long, in ms, a desktop goes without input before it is idle and sleeps; `IDLE_AFTER` when unset. */
  idleAfter?: number;
  /**
   * How long, in ms, the user must have been away to be briefed when they come back; the server's
   * default when unset. `0` briefs on every return with something to tell.
   */
  briefAfter?: number;
  /**
   * Whether the assistant raises what the user may have missed, like asking if their words cover an
   * earlier answer too; the server's default when unset.
   */
  proactive?: boolean;
}

/** Everything an agent is told of the user: their profile and their settings, together. */
export type UserDetails = UserProfile & UserSettings;

/** How fast the assistant speaks when the settings don't say: the voices are a little slow as they come. */
export const SPEECH_RATE = 1;

/** How long a desktop goes without input before it is idle, when the profile doesn't say. */
export const IDLE_AFTER = 5 * 60_000;

/**
 * Where Settings shows `idleAfter` and `briefAfter`, as a link the assistant writes in its answers:
 * the desktop opens it when the user clicks it.
 */
export const IDLE_SETTINGS_LINK = 'wedyan://settings/idle';

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
