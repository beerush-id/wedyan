import { createPackage, type RemoteState } from '@irpclib/irpc';
import { z } from 'zod';
import { wsTransport } from '@/src/api.js';

/**
 * Wedyan's voice. The desktop speaks the answer's spoken parts one sentence at a time, asking for
 * each sentence's audio while the one before it plays; the server holds the speech model. It is the
 * desktop's, never an agent's tool.
 */
export const speech = createPackage({
  name: 'speech',
  version: '1.0.0',
});

speech.use(wsTransport);

/** The voices the user can pick for their assistant: a male and a female one. */
export const VOICES = ['odysseus', 'thalia'] as const;

/** A voice the assistant speaks with. */
export type Voice = (typeof VOICES)[number];

/** The assistant's voice until the user picks one. */
export const DEFAULT_VOICE: Voice = 'odysseus';

/** Longest text spoken in one call: a sentence or two, so the first audio comes back quickly. */
export const SPEAK_LIMIT = 1000;

/** What the speech model answers in. */
export const SPEECH_TYPE = 'audio/wav';

/** One spoken sentence: audio in `SPEECH_TYPE`, base64-encoded. */
export type Speech = { audio: string; type: typeof SPEECH_TYPE };

export type SpeakFn = (text: string, voice?: Voice | null) => Promise<Speech>;

/**
 * Turns a sentence into speech in the given voice, the default one when unset, as one clip: for a
 * one-off line such as a voice preview. Only the two voices are accepted, so a caller can't reach
 * another model. A voice passed as `undefined` arrives as `null` over the wire, so both mean the
 * default.
 */
export const speak = speech.declare<SpeakFn>('speak', () => ({ audio: '', type: SPEECH_TYPE }), {
  schema: { input: [z.string().trim().min(1).max(SPEAK_LIMIT), z.enum(VOICES).nullish()] },
});

/** Spoken text of one answer part, as it streams in. */
export type SayInput = { part: number; text: string };

/**
 * Audio of one answer part, as it is spoken: in `SPEECH_TYPE`, base64-encoded. `last` comes once, with
 * no audio, after the part's last audio: the part is fully spoken once it has played.
 */
export type PlayChunk = { part: number; audio: string; last: boolean };

/**
 * The questions on a voice call: the desktop asks it to say a part's text (`say`) and to finish the
 * part (`end`); the server asks the desktop to play the audio (`play`).
 */
export type VoiceQueries = {
  say: (input: SayInput) => boolean;
  end: (input: { part: number }) => boolean;
  play: (chunk: PlayChunk) => void;
};

export type VoiceFn = (voice?: Voice | null) => RemoteState<Record<string, never>, VoiceQueries>;

/**
 * A live voice for one answer. The desktop opens it in the user's voice, the default one when unset,
 * and feeds it the spoken text as it streams in; it speaks each part's text sentence by sentence, in
 * order, and asks the desktop to play the audio as it is made, so speech starts within a fraction of
 * a second. Closing it stops speaking, mid-sentence if need be.
 */
export const voice = speech.declare<VoiceFn>({
  name: 'voice',
  stream: true,
  keepAlive: true,
  coalesce: false,
  seed: () => ({}),
  schema: { input: [z.enum(VOICES).nullish()] },
});

/** Mic audio `hear` takes: PCM, signed 16-bit little-endian, mono, at this rate. */
export const HEAR_RATE = 24_000;

/**
 * What was heard, as the user speaks: they started a turn (`start`), what they have said so far
 * (`partial`, each one replacing the last), and the turn's whole text once they stopped (`final`).
 */
export type Heard =
  | { type: 'start'; turn: number }
  | { type: 'partial'; turn: number; text: string }
  | { type: 'final'; turn: number; text: string };

/**
 * The questions on a hearing call: the desktop sends mic audio (`audio`, base64 PCM) and ends it
 * (`end`); the server tells the desktop what it heard (`heard`).
 */
export type HearQueries = {
  audio: (pcm: string) => boolean;
  end: () => boolean;
  heard: (heard: Heard) => void;
};

export type HearFn = () => RemoteState<Record<string, never>, HearQueries>;

/**
 * Live hearing for the dock's mic. The desktop streams the mic's audio in as it records, paced at
 * real time; the server transcribes it with Muse Voice Transcribe, finding where each turn starts
 * and ends, and tells the desktop as it goes. The Meta key stays on the server. Closing it, or
 * `end`, stops hearing.
 */
export const hear = speech.declare<HearFn>({
  name: 'hear',
  stream: true,
  keepAlive: true,
  coalesce: false,
  seed: () => ({}),
});
