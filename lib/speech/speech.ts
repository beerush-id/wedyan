import { IRPC_STORE, stream } from '@irpclib/irpc';
import {
  DEFAULT_VOICE,
  type Heard,
  type HearQueries,
  hear,
  type PlayChunk,
  SPEAK_LIMIT,
  speak,
  speech,
  type Voice,
  type VoiceQueries,
  voice,
} from './speech.h.js';

/** The part of the Workers AI binding speech uses. */
export interface SpeechModel {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/** Deepgram's Aura-2 on Workers AI: English, with both of Wedyan's voices. */
export const SPEECH_MODEL = '@cf/deepgram/aura-2-en';

/** Meta's speech-to-text, heard live. */
export const TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0';

/** Where Muse Voice Transcribe hears live audio. */
export const TRANSCRIBE_URL = 'wss://api.meta.ai/v1/asr/realtime';

let ai: SpeechModel | undefined;
let metaKey: string | undefined;

/**
 * Sets what speech runs on. Called once by the server entry with its Workers AI binding, and the
 * Meta key hearing sends Muse Voice Transcribe.
 *
 * @param binding - The Workers AI binding.
 * @param key - The Meta Model API key; hearing is refused without it.
 */
export function setupSpeech(binding: SpeechModel, key?: string): void {
  ai = binding;
  metaKey = key;
}

speech.construct(speak, async (text, speaker) => {
  const result = await model().run(SPEECH_MODEL, { text, speaker: speaker ?? DEFAULT_VOICE, encoding: 'mp3' });
  return { audio: base64Of(await bytesOf(result)), type: 'audio/mpeg' };
});

speech.construct(voice, (speaker) =>
  stream<Record<string, never>, VoiceQueries>((state) => {
    // Played as made: not waited on, so the next audio is never held up by the desktop's answer.
    const speaking = createSpeaking(speaker ?? DEFAULT_VOICE, (chunk) => void state.ask('play', chunk));
    state.answer('say', ({ part, text }) => {
      speaking.say(part, text);
      return true;
    });
    state.answer('end', ({ part }) => {
      speaking.end(part);
      return true;
    });
    return () => speaking.stop();
  }, {}),
);

speech.construct(hear, () => {
  // Checked before the stream opens, so the call fails like any other.
  if (!metaKey) throw new Error('Hearing needs the Meta key');
  const key = metaKey;

  return stream<Record<string, never>, HearQueries>((state, resolve, reject) => {
    const socket = new WebSocket(TRANSCRIBE_URL);
    // Audio that came before the session was ready, sent in order once it is.
    const waiting: Uint8Array[] = [];
    let ready = false;
    let ended = false;
    let turn = 0;
    const tell = (heard: Heard) => void state.ask('heard', heard);

    // Failing closes the socket; its close must not then end the call as if all went well.
    let failed = false;
    const fail = (error: Error) => {
      failed = true;
      reject(error);
    };

    // Ending input lets Meta flush what it still holds; it closes the socket once done.
    const endInput = () => {
      if (ended) return;
      ended = true;
      if (ready) socket.send(END_STREAM);
    };

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${key}` },
          audioEncoding: 'PCM_24KHZ',
          model: TRANSCRIBE_MODEL,
          mode: 'ENDPOINTING',
          partialMode: 'CUMULATIVE',
          emitAudioProgress: false,
        }),
      );
    });
    socket.addEventListener('message', ({ data }) => {
      if (typeof data !== 'string') return;
      const event = JSON.parse(data) as TranscribeEvent;
      // The handshake's answer is the one frame without a type.
      if (!event.type) {
        ready = true;
        for (const frame of waiting.splice(0)) socket.send(frame);
        if (ended) socket.send(END_STREAM);
        return;
      }
      if (event.type === 'error') return fail(new Error(event.message ?? 'Hearing failed'));
      if (event.type === 'speechStart') {
        turn = event.turnId ?? turn;
        tell({ type: 'start', turn });
      } else if (event.type === 'transcript' && !event.final && event.transcript) {
        tell({ type: 'partial', turn, text: event.transcript });
      } else if (event.type === 'speechComplete' && event.transcript) {
        tell({ type: 'final', turn: event.turnId ?? turn, text: event.transcript });
      }
    });
    socket.addEventListener('close', () => {
      if (!failed) resolve();
    });
    socket.addEventListener('error', () => fail(new Error('Hearing lost its connection')));

    state.answer('audio', (pcm) => {
      if (ended) return false;
      const frame = Uint8Array.from(atob(pcm), (char) => char.charCodeAt(0));
      if (ready) socket.send(frame);
      else waiting.push(frame);
      return true;
    });
    state.answer('end', () => {
      endInput();
      return true;
    });

    return () => {
      endInput();
      socket.close();
    };
  }, {});
});

/** What Muse Voice Transcribe sends back, as far as hearing reads it. */
type TranscribeEvent = {
  type?: string;
  turnId?: number;
  transcript?: string;
  final?: boolean;
  message?: string;
};

/** The control frame that ends a hearing session's input. */
const END_STREAM = JSON.stringify({ type: 'endStream' });

/** Audio gathered before it goes to the desktop: enough to play smoothly, in few enough asks. */
const BATCH_BYTES = 8192;

/** Longest audio is held before it goes, so the first words are never kept waiting. */
const BATCH_MS = 100;

/**
 * Speaks text as it streams in, in one voice. Each part's text is held until a sentence ends, so a
 * word is never cut; what is ready is spoken in arrival order, one utterance after another, and its
 * audio is handed to `play` in batches as the model makes it. Ending a part speaks what is left of
 * it, then tells `play` the part is done. Stopping drops everything not yet spoken.
 *
 * @param speaker - The voice to speak with.
 * @param play - Receives the audio, in order, tagged with its part.
 * @returns What feeds it: `say`, `end` and `stop`.
 */
function createSpeaking(speaker: Voice, play: (chunk: PlayChunk) => void) {
  const pending = new Map<number, string>();
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  // One utterance at a time, in order; a failed one is logged and the next still speaks.
  const enqueue = (work: () => Promise<void>) => {
    queue = queue
      .then(() => (stopped ? undefined : work()))
      .catch((error: Error) => IRPC_STORE.error(error, [{ speech: speaker }]));
  };

  const utter = (part: number, text: string) =>
    enqueue(async () => {
      for (const piece of piecesOf(text)) {
        if (stopped) return;
        const result = await model().run(SPEECH_MODEL, { text: piece, speaker, encoding: 'mp3' });
        if (!(result instanceof ReadableStream)) {
          play({ part, audio: base64Of(await bytesOf(result)), last: false });
          continue;
        }

        reader = result.getReader();
        let batch: Uint8Array[] = [];
        let size = 0;
        let since = Date.now();
        const flush = () => {
          if (!size) return;
          play({ part, audio: base64Of(joined(batch, size)), last: false });
          batch = [];
          size = 0;
          since = Date.now();
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done || stopped) break;
          batch.push(value);
          size += value.byteLength;
          if (size >= BATCH_BYTES || Date.now() - since >= BATCH_MS) flush();
        }
        reader = undefined;
        if (!stopped) flush();
      }
    });

  return {
    say(part: number, text: string) {
      const buffered = (pending.get(part) ?? '') + text;
      const cut = sentencesEnd(buffered);
      if (cut > 0 && buffered.slice(0, cut).trim()) utter(part, buffered.slice(0, cut));
      pending.set(part, buffered.slice(cut));
    },
    end(part: number) {
      const rest = pending.get(part)?.trim();
      pending.delete(part);
      if (rest) utter(part, rest);
      enqueue(async () => play({ part, audio: '', last: true }));
    },
    stop() {
      stopped = true;
      pending.clear();
      void reader?.cancel();
    },
  };
}

/** The model speech runs on; throws before `setupSpeech`. */
function model(): SpeechModel {
  if (!ai) throw new Error('Speech is not set up');
  return ai;
}

/** Where the text's last whole sentence ends, past its closing quotes and the space after; 0 for none. */
function sentencesEnd(text: string): number {
  let end = 0;
  for (const match of text.matchAll(/[.!?…]["')\]]*\s+/g)) end = match.index + match[0].length;
  return end;
}

/** Text in pieces the model takes in one call, cut at sentence ends where it can be. */
function piecesOf(text: string): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > SPEAK_LIMIT) {
    const cut = sentencesEnd(rest.slice(0, SPEAK_LIMIT)) || SPEAK_LIMIT;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Chunks of audio as one. */
function joined(chunks: Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The audio the model returned, whether it came as a stream or as bytes. */
async function bytesOf(result: unknown): Promise<Uint8Array> {
  if (result instanceof ReadableStream) return new Uint8Array(await new Response(result).arrayBuffer());
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;
  throw new Error('Speech model returned no audio');
}

/** Bytes as base64, in chunks, so a long clip never overflows the call stack. */
function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
