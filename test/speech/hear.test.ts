import { withContext } from '@irpclib/irpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Heard, hear } from '../../lib/speech/speech.h.js';
import { setupSpeech, TRANSCRIBE_MODEL, TRANSCRIBE_URL } from '../../lib/speech/speech.js';

// Muse Voice Transcribe is an external service, so its realtime socket is faked: it opens, records
// what was sent, and answers with the events a test gives it.

/** A WebSocket client standing in for Meta's realtime endpoint. */
class FakeSocket extends EventTarget {
  static last: FakeSocket;
  sent: Array<string | Uint8Array> = [];
  closed = false;

  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }

  /** The server sends an event. */
  receive(event: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  /** What was sent as JSON, parsed; audio frames as their bytes. */
  get frames() {
    return this.sent.map((frame) => (typeof frame === 'string' ? JSON.parse(frame) : [...frame]));
  }
}

/** PCM bytes as the desktop sends them: base64. */
const pcm = (...bytes: number[]) => btoa(String.fromCharCode(...bytes));

/** Lets queued events run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('hear', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    setupSpeech({ run: vi.fn() }, 'meta-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a session with the key on the server, in endpointing mode at 24 kHz', async () => {
    await withContext(async () => {
      const call = hear();
      await tick();

      expect(FakeSocket.last.url).toBe(TRANSCRIBE_URL);
      expect(FakeSocket.last.frames[0]).toEqual({
        authorization: { accessToken: 'Bearer meta-key' },
        audioEncoding: 'PCM_24KHZ',
        model: TRANSCRIBE_MODEL,
        mode: 'ENDPOINTING',
        partialMode: 'CUMULATIVE',
        emitAudioProgress: false,
      });
      call.close();
    });
  });

  it('holds audio until the session is ready, then sends it in order', async () => {
    await withContext(async () => {
      const call = hear();
      await tick();

      await call.ask('audio', pcm(1, 2));
      await call.ask('audio', pcm(3));
      expect(FakeSocket.last.sent).toHaveLength(1);

      FakeSocket.last.receive({ sessionId: 's1' });
      await call.ask('audio', pcm(4, 5));

      expect(FakeSocket.last.frames.slice(1)).toEqual([[1, 2], [3], [4, 5]]);
      call.close();
    });
  });

  it('tells the desktop when a turn starts, what is heard so far, and the turn’s whole text', async () => {
    await withContext(async () => {
      const call = hear();
      const heard: Heard[] = [];
      call.answer('heard', (event) => void heard.push(event));
      await tick();
      const socket = FakeSocket.last;

      socket.receive({ sessionId: 's1' });
      socket.receive({ type: 'speechStart', turnId: 0, audioProcessedMs: 860 });
      socket.receive({ type: 'transcript', transcript: 'Open', final: false });
      socket.receive({ type: 'transcript', transcript: 'Open the second mail.', final: false });
      socket.receive({ type: 'speechEnd', turnId: 0 });
      socket.receive({ type: 'speechComplete', turnId: 0, transcript: 'Open the second mail.' });
      socket.receive({ type: 'audioProgress', audioProcessedMs: 4000 });
      socket.receive({ type: 'speechStart', turnId: 1 });
      socket.receive({ type: 'speechComplete', turnId: 1, transcript: 'Delete it.' });
      await tick();

      expect(heard).toEqual([
        { type: 'start', turn: 0 },
        { type: 'partial', turn: 0, text: 'Open' },
        { type: 'partial', turn: 0, text: 'Open the second mail.' },
        { type: 'final', turn: 0, text: 'Open the second mail.' },
        { type: 'start', turn: 1 },
        { type: 'final', turn: 1, text: 'Delete it.' },
      ]);
      call.close();
    });
  });

  it('ends input on end, takes no audio after, and completes once the server closes', async () => {
    await withContext(async () => {
      const call = hear();
      await tick();
      const socket = FakeSocket.last;
      socket.receive({ sessionId: 's1' });

      await call.ask('end');
      expect(await call.ask('audio', pcm(9))).toBe(false);
      expect(socket.frames.at(-1)).toEqual({ type: 'endStream' });

      socket.close();
      await expect(call).resolves.toBeDefined();
    });
  });

  it('ends input and closes the socket when the desktop closes the call', async () => {
    await withContext(async () => {
      const call = hear();
      await tick();
      const socket = FakeSocket.last;
      socket.receive({ sessionId: 's1' });

      call.close();
      await tick();

      expect(socket.frames.at(-1)).toEqual({ type: 'endStream' });
      expect(socket.closed).toBe(true);
    });
  });

  it('fails when the service reports an error, and refuses to hear without the Meta key', async () => {
    await withContext(async () => {
      const call = hear();
      await tick();
      FakeSocket.last.receive({ type: 'error', message: 'invalid key' });
      await expect(call).rejects.toThrow('invalid key');
    });

    setupSpeech({ run: vi.fn() });
    await withContext(async () => {
      await expect(hear()).rejects.toThrow('Hearing needs the Meta key');
    });
  });
});
