import { createContext, mutable } from '@airlib/react';
import { createPlayer } from '@/lib/share/audio.js';
import { dfs } from '@/lib/share/dfs.js';
import type { VoiceCall } from '@/lib/share/hands-free.js';
import { PROFILE_PATH, SETTINGS_PATH, SPEECH_RATE, type UserProfile, type UserSettings } from '@/lib/share/profile.js';
import { DEFAULT_VOICE, type Voice, voice as openVoice } from '@/lib/speech/speech.h.js';

/** The pages Settings shows down its side. */
export type SettingsSection = 'general' | 'account';

/** A group a page can be opened at, scrolled into view: `idle` is General's idle settings. */
export type SettingsFocus = 'idle';

/** Where Settings opens: a page, and a group on it to bring into view. */
export interface SettingsPlace {
  section: SettingsSection;
  focus?: SettingsFocus;
}

/** The files Settings' pages edit: every control changes one in place, and it saves itself. */
export type SettingsFiles = {
  /** Whether both files have arrived. */
  readonly ready: boolean;
  /** General: how the assistant works with the user (`~/settings.json`). */
  readonly settings: UserSettings;
  /** Account: who the user is (`~/profile.json`). */
  readonly profile: UserProfile;
  /** The settings left unset, shown as what they mean; set, they're written to the file. */
  readonly shown: { voice: Voice; speechRate: number; proactive: boolean; idleAfter: number; briefAfter: number };
  /** The assistant's name as the user sees it: what they called it, or the default. */
  assistantName(): string;
  /** Sets idle low enough to see a briefing in a minute: away after one minute, briefed on every return. */
  tryIdle(): void;
  /** The voice being previewed, from asking for it until it has finished speaking. */
  readonly previewing: { voice?: Voice };
  /** Introduces the assistant in a voice, live, to hear it before picking it. */
  preview(voice: Voice): Promise<void>;
};

/** What the assistant is called when the user gave it no name. */
export const DEFAULT_ASSISTANT_NAME = 'Wedyan';

/** The voices the assistant speaks with, the default first. */
export const VOICES: { value: Voice; label: string; description: string }[] = [
  { value: 'odysseus', label: 'Odysseus', description: 'A male voice' },
  { value: 'thalia', label: 'Thalia', description: 'A female voice' },
];

const MINUTE = 60_000;

/** What the server goes by when the settings leave one unset; durations in ms. */
const DEFAULTS = { idleAfter: 5 * MINUTE, briefAfter: 10 * MINUTE, proactive: true };

/** The files Settings' window is editing, for its pages. */
export const settingsCtx = createContext<SettingsFiles>();

/** The page Settings shows, and the group to bring into view once it's shown. */
export const place = mutable<SettingsPlace>({ section: 'general' });

/**
 * Binds the files Settings edits, with the window. Neither is made by opening Settings: a new user
 * has no profile, which is what starts onboarding, until they change something.
 *
 * @returns What Settings' pages edit.
 */
export function bindSettings(): SettingsFiles {
  const settingsFile = dfs.binding<UserSettings>(SETTINGS_PATH, { blank: {} });
  const profileFile = dfs.binding<UserProfile>(PROFILE_PATH, { blank: {} });
  const settings = () => settingsFile.data as UserSettings;
  const assistantName = () => settings().assistantName?.trim() || DEFAULT_ASSISTANT_NAME;
  const previewing = mutable<{ voice?: Voice }>({});

  return {
    get ready() {
      return settingsFile.ready && profileFile.ready;
    },
    get settings() {
      return settings();
    },
    get profile() {
      return profileFile.data as UserProfile;
    },
    shown: mutable({
      get voice() {
        return settings().voice ?? DEFAULT_VOICE;
      },
      set voice(value: Voice) {
        settings().voice = value;
      },
      get speechRate() {
        return settings().speechRate ?? SPEECH_RATE;
      },
      set speechRate(value: number) {
        settings().speechRate = value;
      },
      get proactive() {
        return settings().proactive ?? DEFAULTS.proactive;
      },
      set proactive(value: boolean) {
        settings().proactive = value;
      },
      // In minutes, as the user reads them; in ms in the file.
      get idleAfter() {
        return (settings().idleAfter ?? DEFAULTS.idleAfter) / MINUTE;
      },
      set idleAfter(value: number) {
        settings().idleAfter = value * MINUTE;
      },
      get briefAfter() {
        return (settings().briefAfter ?? DEFAULTS.briefAfter) / MINUTE;
      },
      set briefAfter(value: number) {
        settings().briefAfter = value * MINUTE;
      },
    }),
    assistantName,
    tryIdle: () => {
      settings().idleAfter = MINUTE;
      settings().briefAfter = 0;
    },
    previewing,
    preview: async (voice) => {
      previewing.voice = voice;
      try {
        await speakLive(sampleOf(assistantName()), voice, settings().speechRate ?? SPEECH_RATE);
      } finally {
        previewing.voice = undefined;
      }
    },
  };
}

/** Speaks a line in a voice as its audio is made, the way answers are; lasts until it has played. */
function speakLive(text: string, voice: Voice, rate: number): Promise<void> {
  return new Promise((played) => {
    const PART = 0;
    const player = createPlayer(rate);
    const call = openVoice(voice) as unknown as VoiceCall;

    call.answer('play', ({ audio, last }) => {
      if (!last) return player.push(audio);
      player.finish(() => {
        call.close();
        player.stop();
        played();
      });
    });
    void call.ask('say', { part: PART, text });
    void call.ask('end', { part: PART });
  });
}

/** What a voice says when previewed: long enough to hear how it sounds, in the assistant's own name. */
function sampleOf(name: string): string {
  return `Hi, I'm ${name}, your assistant. This is how I'll sound when we talk.`;
}

/**
 * Shows a page, and brings a group on it into view when one is named.
 *
 * @param to - The page, and the group.
 */
export function goTo(to: SettingsPlace) {
  Object.assign(place, { focus: undefined }, to);
}
