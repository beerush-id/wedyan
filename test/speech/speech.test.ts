import { IRPC_STORE, withContext } from '@irpclib/irpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE, type PlayChunk, SPEAK_LIMIT, speak, voice } from '../../lib/speech/speech.h.js';
import { SPEECH_MODEL, setupSpeech } from '../../lib/speech/speech.js';

// Workers AI is an external service, so its text-to-speech is faked: it returns a stream of bytes,
// as the binding does.

/** A fake Workers AI binding answering with these bytes, recording what it was asked. */
function fakeAI(bytes = new Uint8Array([1, 2, 3, 250])) {
  return {
    run: vi.fn(async (_model: string, _input: Record<string, unknown>) => new Response(bytes).body),
  };
}

describe('speak', () => {
  let ai: ReturnType<typeof fakeAI>;

  beforeEach(() => {
    ai = fakeAI();
    setupSpeech(ai);
  });

  it('turns a sentence into base64 MP3 audio in the default voice', async () => {
    const result = await withContext(() => speak('Good morning, Nanang!'));

    expect(result).toEqual({ audio: btoa(String.fromCharCode(1, 2, 3, 250)), type: 'audio/mpeg' });
    expect(ai.run).toHaveBeenCalledWith(SPEECH_MODEL, {
      text: 'Good morning, Nanang!',
      speaker: DEFAULT_VOICE,
      encoding: 'mp3',
    });
  });

  it('speaks in the default voice when the voice is missing, as undefined or as null from the wire', async () => {
    await withContext(() => speak('Hi.', undefined));
    await withContext(() => speak('Hi.', null));

    expect(ai.run.mock.calls.map(([, input]) => input.speaker)).toEqual([DEFAULT_VOICE, DEFAULT_VOICE]);
  });

  it('speaks in the voice the user picked', async () => {
    await withContext(() => speak('Nice to meet you!', 'thalia'));

    expect(ai.run).toHaveBeenCalledWith(SPEECH_MODEL, expect.objectContaining({ speaker: 'thalia' }));
  });

  it('encodes a long clip whole', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    setupSpeech(fakeAI(bytes));

    const { audio } = await withContext(() => speak('A long sentence.'));

    expect(Uint8Array.from(atob(audio), (char) => char.charCodeAt(0))).toEqual(bytes);
  });

  it('refuses a voice it doesn’t offer, empty text, and text past the limit, before calling the model', async () => {
    await expect(withContext(() => speak('Hi.', 'zeus' as never))).rejects.toThrow();
    await expect(withContext(() => speak('   '))).rejects.toThrow();
    await expect(withContext(() => speak('a'.repeat(SPEAK_LIMIT + 1)))).rejects.toThrow();
    expect(ai.run).not.toHaveBeenCalled();
  });
});

/** A stream of these chunks, each after `delay` ms, as the binding streams speech. */
const streamOf = (chunks: Uint8Array[], delay = 0) =>
  new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = chunks.shift();
      if (!next) return controller.close();
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      controller.enqueue(next);
    },
  });

/** A fake Workers AI binding streaming `count` chunks of `size` bytes per call. */
function streamingAI(count = 3, size = 4096, delay = 0) {
  return {
    run: vi.fn(async (_model: string, _input: Record<string, unknown>) =>
      streamOf(
        Array.from({ length: count }, (_, i) => new Uint8Array(size).fill(i)),
        delay,
      ),
    ),
  };
}

/** Waits until `check` holds, failing after `timeout` ms. */
async function until(check: () => boolean, timeout = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const bytesIn = (chunks: PlayChunk[]) => chunks.reduce((sum, chunk) => sum + atob(chunk.audio).length, 0);

describe('voice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('speaks each part by whole sentences, in order, and tells when each part is done', async () => {
    const ai = streamingAI();
    setupSpeech(ai);

    await withContext(async () => {
      const call = voice('thalia');
      const played: PlayChunk[] = [];
      call.answer('play', (chunk) => void played.push(chunk));

      await call.ask('say', { part: 0, text: 'Good morn' });
      expect(ai.run).not.toHaveBeenCalled();
      await call.ask('say', { part: 0, text: 'ing, Nanang! Your render' });
      await call.ask('end', { part: 0 });
      await call.ask('say', { part: 2, text: 'Opening Motion.' });
      await call.ask('end', { part: 2 });
      await until(() => played.some((chunk) => chunk.part === 2 && chunk.last));

      expect(ai.run.mock.calls.map(([, input]) => [input.text, input.speaker])).toEqual([
        ['Good morning, Nanang!', 'thalia'],
        ['Your render', 'thalia'],
        ['Opening Motion.', 'thalia'],
      ]);
      // Part 0's audio, then its end, then part 2's: order is kept across parts.
      const order = played.map((chunk) => `${chunk.part}${chunk.last ? ' done' : ''}`);
      expect(order).toEqual([
        ...order.filter((step) => step === '0'),
        '0 done',
        ...order.filter((step) => step === '2'),
        '2 done',
      ]);
      expect(bytesIn(played.filter((chunk) => chunk.part === 0))).toBe(2 * 3 * 4096);
      call.close();
    });
  });

  it('sends audio in batches, not chunk by chunk', async () => {
    setupSpeech(streamingAI(40, 512));

    await withContext(async () => {
      const call = voice();
      const played: PlayChunk[] = [];
      call.answer('play', (chunk) => void played.push(chunk));

      await call.ask('say', { part: 0, text: 'One long sentence.' });
      await call.ask('end', { part: 0 });
      await until(() => played.some((chunk) => chunk.last));

      const audio = played.filter((chunk) => !chunk.last);
      expect(bytesIn(audio)).toBe(40 * 512);
      expect(audio.length).toBeLessThan(40);
      call.close();
    });
  });

  it('stops speaking when closed, mid-sentence, and plays nothing after', async () => {
    const ai = streamingAI(20, 4096, 30);
    setupSpeech(ai);

    await withContext(async () => {
      const call = voice();
      const played: PlayChunk[] = [];
      call.answer('play', (chunk) => void played.push(chunk));

      await call.ask('say', { part: 0, text: 'A long briefing about everything that happened overnight.' });
      await call.ask('end', { part: 0 });
      await until(() => played.length > 0);
      call.close();
      const atClose = played.length;
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(played.length).toBe(atClose);
      expect(played.some((chunk) => chunk.last)).toBe(false);
    });
  });

  it('logs an utterance that fails, and still speaks the next', async () => {
    const logged = vi.spyOn(IRPC_STORE, 'error').mockImplementation(() => {});
    const ai = streamingAI(1);
    ai.run.mockRejectedValueOnce(new Error('speech is down'));
    setupSpeech(ai);

    await withContext(async () => {
      const call = voice();
      const played: PlayChunk[] = [];
      call.answer('play', (chunk) => void played.push(chunk));

      await call.ask('say', { part: 0, text: 'Lost. ' });
      await call.ask('say', { part: 0, text: 'Kept.' });
      await call.ask('end', { part: 0 });
      await until(() => played.some((chunk) => chunk.last));

      expect(played.filter((chunk) => !chunk.last)).toHaveLength(1);
      expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'speech is down' }), [
        { speech: DEFAULT_VOICE },
      ]);
      call.close();
    });
  });
});
