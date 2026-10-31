import { IRPC_STATUS } from '@irpclib/irpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskPart } from '../../lib/kernel/agent.h.js';
import type { AgentMessage } from '../../lib/kernel/chat.h.js';
import type { Player } from '../../lib/share/audio.js';
import { createHandsFree, type HandsFreeDevices } from '../../lib/share/hands-free.js';
import type { Heard, PlayChunk } from '../../lib/speech/speech.h.js';

// Hands-free's decisions, on fake devices: a browser's mic and speakers aren't here to test, and
// neither is Meta's transcription. What runs for real is when it listens, speaks and stops.

type Hearing = ReturnType<HandsFreeDevices['hear']> & { hears: (heard: Heard) => void; end: (status: string) => void };

/** A desktop of fakes, remembering what happened to them. */
function setup(options: { micFails?: string } = {}) {
  const log = {
    frames: [] as string[],
    sent: [] as string[],
    said: [] as unknown[],
    ended: [] as number[],
    pushed: [] as string[],
    voices: [] as unknown[],
    clips: [] as string[],
    micClosed: 0,
    voiceClosed: 0,
    hearingClosed: 0,
    stopped: 0,
  };
  const hearings: Hearing[] = [];
  let toMic: (pcm: string) => void = () => undefined;
  let play: (chunk: PlayChunk) => void = () => undefined;
  const finishing: (() => void)[] = [];
  let endClip: () => void = () => undefined;

  const player: Player = {
    push: (audio) => void log.pushed.push(audio),
    finish: (played) => void finishing.push(played),
    stop: () => {
      log.stopped += 1;
    },
  };

  const devices: HandsFreeDevices = {
    microphone: async (onFrame) => {
      if (options.micFails) throw new Error(options.micFails);
      toMic = onFrame;
      return () => {
        log.micClosed += 1;
      };
    },
    player: () => player,
    hear() {
      let onHeard: (heard: Heard) => void = () => undefined;
      let listener: () => void = () => undefined;
      const call: Hearing = {
        status: IRPC_STATUS.IDLE,
        answer: (_name, handler) => {
          onHeard = handler;
        },
        ask: (_name, pcm) => log.frames.push(pcm),
        subscribe: (fn) => {
          listener = fn;
        },
        close: () => {
          log.hearingClosed += 1;
        },
        hears: (heard) => onHeard(heard),
        end: (status) => {
          call.status = status;
          listener();
        },
      };
      hearings.push(call);
      return call;
    },
    voice(voice) {
      log.voices.push(voice);
      return {
        answer: (_name, handler) => {
          play = handler;
        },
        ask: (name: string, input: { part: number; text?: string }) => {
          if (name === 'say') log.said.push(input);
          else log.ended.push(input.part);
        },
        close: () => {
          log.voiceClosed += 1;
        },
      };
    },
    voiceOf: () => 'thalia',
    send: (text) => log.sent.push(text),
    clip: async (text, voice) => {
      log.voices.push(voice);
      log.clips.push(text);
      return new Promise<void>((resolve) => {
        endClip = resolve;
      });
    },
    stopClip: () => endClip(),
  };

  const handsFree = createHandsFree(devices);
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  return {
    ...handsFree,
    log,
    hearing: () => hearings.at(-1) as Hearing,
    hearings,
    mic: (pcm: string) => toMic(pcm),
    play: (chunk: PlayChunk) => play(chunk),
    /** Everything pushed so far finishes playing. */
    playOut: () => {
      for (const played of finishing.splice(0)) played();
    },
    on: async () => {
      handsFree.speech.toggle();
      await flush();
    },
  };
}

const text = (value: string, done = true): AskPart => ({
  type: 'text',
  chunks: [value],
  ...(done ? { text: value } : {}),
  spoken: true,
});

const answer = (id: string, parts: AskPart[], status: AgentMessage['status'] = 'running'): AgentMessage => ({
  id,
  role: 'agent',
  created: '',
  status,
  agent: 'wendy',
  turn: 1,
  parts,
  actions: [],
});

describe('hands-free', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the mic and hearing with the switch, and closes both with it', async () => {
    const free = setup();

    await free.on();
    free.mic('frame-1');
    expect(free.log.frames).toEqual(['frame-1']);

    free.speech.listening = false;
    expect(free.log.micClosed).toBe(1);
    expect(free.log.hearingClosed).toBe(1);
  });

  it('shows what’s being said, and sends the whole turn once it’s finished, keeping the mic open', async () => {
    const free = setup();
    await free.on();

    free.hearing().hears({ type: 'start', turn: 1 });
    free.hearing().hears({ type: 'partial', turn: 1, text: 'Make her' });
    expect(free.speech.heard).toBe('Make her');

    free.hearing().hears({ type: 'final', turn: 1, text: 'Make her angry' });
    expect(free.log.sent).toEqual(['Make her angry']);
    expect(free.speech.heard).toBe('');
    expect(free.log.micClosed).toBe(0);
  });

  it('sends nothing for a turn with no words', async () => {
    const free = setup();
    await free.on();

    free.hearing().hears({ type: 'final', turn: 1, text: '  ' });

    expect(free.log.sent).toEqual([]);
  });

  it('speaks an answer as it streams, in the user’s voice, and ends each part once', async () => {
    const free = setup();
    await free.on();

    const part = text('Hello', false);
    const message = answer('a1', [part]);
    free.sync([message]);
    expect(free.speech.speaking).toBe(true);
    expect(free.log.voices).toEqual(['thalia']);

    (part as { chunks: string[] }).chunks.push(' there.');
    Object.assign(part, { text: 'Hello there.' });
    free.sync([message]);
    free.sync([message]);

    expect(free.log.said).toEqual([
      { part: 0, text: 'Hello' },
      { part: 0, text: ' there.' },
    ]);
    expect(free.log.ended).toEqual([0]);
  });

  it('plays what comes, and stops being busy only once all of it has played', async () => {
    const free = setup();
    await free.on();
    const message = answer('a1', [text('Hello.')]);
    free.sync([message]);

    free.play({ part: 0, audio: 'mp3', last: false });
    free.play({ part: 0, audio: '', last: true });
    message.status = 'done';
    free.sync([message]);
    expect(free.log.pushed).toEqual(['mp3']);
    expect(free.speech.speaking).toBe(true);

    free.playOut();
    expect(free.speech.speaking).toBe(false);
    expect(free.log.voiceClosed).toBe(1);
  });

  it('leaves silent parts out, and says nothing while not listening', async () => {
    const free = setup();

    free.sync([answer('a1', [text('Hello.')])]);
    expect(free.log.said).toEqual([]);

    await free.on();
    free.sync([
      answer('a1', [text('Hello.')]),
      answer('a2', [{ type: 'text', chunks: ['Quiet.'], text: 'Quiet.', spoken: false }], 'done'),
    ]);
    expect(free.log.said).toEqual([]);
  });

  it('stops at once when the user talks over it, and doesn’t pick that answer up again', async () => {
    const free = setup();
    await free.on();
    const message = answer('a1', [text('A long answer.')]);
    free.sync([message]);

    free.hearing().hears({ type: 'start', turn: 2 });

    expect(free.log.stopped).toBe(1);
    expect(free.log.voiceClosed).toBe(1);
    expect(free.speech.speaking).toBe(false);

    message.parts.push(text('And more.'));
    free.sync([message]);
    expect(free.log.said).toHaveLength(1);
  });

  it('speaks the next answer after an interruption', async () => {
    const free = setup();
    await free.on();
    const first = answer('a1', [text('First.')]);
    free.sync([first]);
    free.hearing().hears({ type: 'start', turn: 2 });

    free.sync([first, answer('a2', [text('Second.')])]);

    expect(free.log.said).toEqual([
      { part: 0, text: 'First.' },
      { part: 0, text: 'Second.' },
    ]);
  });

  it('speaks answers one at a time', async () => {
    const free = setup();
    await free.on();
    const first = answer('a1', [text('First.')], 'done');
    const second = answer('a2', [text('Second.')], 'done');

    free.sync([first, second]);
    expect(free.log.said).toEqual([{ part: 0, text: 'First.' }]);

    free.play({ part: 0, audio: '', last: true });
    free.playOut();
    expect(free.log.said).toEqual([
      { part: 0, text: 'First.' },
      { part: 0, text: 'Second.' },
    ]);
  });

  it('doesn’t read out what was said before listening began', async () => {
    const free = setup();
    free.sync([answer('a1', [text('Old news.')], 'done')]);

    await free.on();
    free.sync([answer('a1', [text('Old news.')], 'done')]);

    expect(free.log.said).toEqual([]);
  });

  it('holds an action until the part before it has played', async () => {
    const free = setup();
    await free.on();
    free.sync([answer('a1', [text('Opening it.')])]);
    let ran = false;

    void free.played(0).then(() => {
      ran = true;
    });
    await Promise.resolve();
    expect(ran).toBe(false);

    free.play({ part: 0, audio: '', last: true });
    free.playOut();
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it('never holds an action for a part that isn’t spoken, or once it’s interrupted', async () => {
    const free = setup();
    await expect(free.played(0)).resolves.toBeUndefined();

    await free.on();
    free.sync([answer('a1', [text('Opening it.')])]);
    const waiting = free.played(0);
    free.hearing().hears({ type: 'start', turn: 2 });

    await expect(waiting).resolves.toBeUndefined();
  });

  it('stops listening, and says why, when the mic is refused', async () => {
    const free = setup({ micFails: 'Permission denied' });

    await free.on();

    expect(free.speech).toMatchObject({ listening: false, problem: 'Permission denied' });
  });

  it('stops listening, and says why, when hearing fails', async () => {
    const free = setup();
    await free.on();
    const call = free.hearing();
    call.error = { message: 'You’ve reached today’s limit for this.' };

    call.end(IRPC_STATUS.ERROR);

    expect(free.speech).toMatchObject({ listening: false, problem: 'You’ve reached today’s limit for this.' });
  });

  it('reads one thing aloud on request, in the user’s voice, and shows it’s speaking until it’s done', async () => {
    const free = setup();

    const reading = free.speech.speak('Read this.');
    await Promise.resolve();
    expect(free.log.clips).toEqual(['Read this.']);
    expect(free.log.voices).toEqual(['thalia']);
    expect(free.speech.speaking).toBe(true);

    free.speech.stop();
    await reading;
    expect(free.speech.speaking).toBe(false);
  });

  it('stops whatever is being spoken on request', async () => {
    const free = setup();
    await free.on();
    free.sync([answer('a1', [text('A long answer.')])]);

    free.speech.stop();

    expect(free.log.voiceClosed).toBe(1);
    expect(free.speech.speaking).toBe(false);
  });

  it('opens a new hearing call when one reaches its time limit, keeping the mic', async () => {
    const free = setup();
    await free.on();

    free.hearing().end(IRPC_STATUS.SUCCESS);

    expect(free.hearings).toHaveLength(2);
    expect(free.log.micClosed).toBe(0);
    free.mic('frame');
    expect(free.log.frames).toEqual(['frame']);
  });
});
