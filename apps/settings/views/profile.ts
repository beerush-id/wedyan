import { mutable } from '@airlib/react';
import type { UserProfile } from '@/lib/share/profile.js';
import ACCOUNT from '../data/account.json';
import PROFILE from '../data/profile.json';

/** The pages Settings shows down its side. */
export type SettingsSection = 'general' | 'account';

/** A group a page can be opened at, scrolled into view: `idle` is General's idle settings. */
export type SettingsFocus = 'idle';

/** Where Settings opens: a page, and a group on it to bring into view. */
export interface SettingsPlace {
  section: SettingsSection;
  focus?: SettingsFocus;
}

/** Who the user is signed in as. */
export interface SettingsAccount {
  name: string;
  email: string;
  picture?: string;
}

/** What the assistant is called when the user gave it no name. */
export const DEFAULT_ASSISTANT_NAME = 'Wedyan';

/** The voices the assistant speaks with, the default first. */
export const VOICES: { value: NonNullable<UserProfile['voice']>; label: string; description: string }[] = [
  { value: 'odysseus', label: 'Odysseus', description: 'A male voice' },
  { value: 'thalia', label: 'Thalia', description: 'A female voice' },
];

const MINUTE = 60_000;

/** What the server goes by when the profile leaves a duration unset, in ms. */
const DEFAULTS = { idleAfter: 5 * MINUTE, briefAfter: 10 * MINUTE };

/** The user's profile, shaped like `~/profile.json`; every control edits it in place. */
export const profile = mutable(PROFILE as UserProfile);

/** Who the user is signed in as. */
export const account = mutable(ACCOUNT as SettingsAccount);

/** The page Settings shows, and the group to bring into view once it's shown. */
export const place = mutable<SettingsPlace>({ section: 'general' });

/**
 * The profile's durations in minutes, as the user reads them, written back to the profile in ms.
 * It keeps nothing of its own.
 */
export const minutes = mutable({
  get idleAfter() {
    return (profile.idleAfter ?? DEFAULTS.idleAfter) / MINUTE;
  },
  set idleAfter(value: number) {
    profile.idleAfter = value * MINUTE;
  },
  get briefAfter() {
    return (profile.briefAfter ?? DEFAULTS.briefAfter) / MINUTE;
  },
  set briefAfter(value: number) {
    profile.briefAfter = value * MINUTE;
  },
});

/**
 * The assistant's name as the user sees it: what they called it, or the default.
 *
 * @returns The name.
 */
export function assistantName(): string {
  return profile.assistantName?.trim() || DEFAULT_ASSISTANT_NAME;
}

/**
 * Shows a page, and brings a group on it into view when one is named.
 *
 * @param to - The page, and the group.
 */
export function goTo(to: SettingsPlace) {
  Object.assign(place, { focus: undefined }, to);
}

/**
 * Sets idle low enough to see a briefing in a minute: away after one minute, briefed on every return.
 */
export function tryIdle() {
  profile.idleAfter = MINUTE;
  profile.briefAfter = 0;
}
