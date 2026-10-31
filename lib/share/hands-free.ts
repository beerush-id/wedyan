import { mutable, subscribe } from '@airlib/react';
import { IRPC_STATUS } from '@irpclib/irpc';
import type { AgentMessage, ConversationMessage } from '@/lib/kernel/chat.h.js';
import type { Heard, PlayChunk, SayInput, Voice } from '@/lib/speech/speech.h.js';
import type { Player } from './audio.js';

/** The part of a hearing call this uses. */
type HearingCall = {
  status: string;
  error?: { message: string } | null;
  answer(name: 'heard', handler: (heard: Heard) => void): unknown;
  ask(name: 'audio', pcm: string): unknown;
  subscribe(listener: () => void): unknown;
  close(): void;
};

/** The part of a voice call this uses. */
type VoiceCall = {
  answer(name: 'play', handler: (chunk: PlayChunk) => void): unknown;
  ask(name: 'say', input: SayInput): unknown;
  ask(name: 'end', input: { part: number }): unknown;
  close(): void;
};

/** What hands-free runs on: the browser's audio, the speech calls, and the conversation. */
export type HandsFreeDevices = {
  microphone(onFrame: (pcm: string) => void): Promise<() => void>;
  player(): Player;
  hear(): HearingCall;
  voice(voice?: Voice | null): VoiceCall;
  /** The voice the user picked, when they did. */
  voiceOf(): Voice | undefined;
  /** Sends what the user said. */
  send(text: string): unknown;
  /** Reads one thing aloud; lasts until it's played or stopped. */
  clip(text: string, voice?: Voice | null): Promise<void>;
  /** Stops what `clip` is playing. */
  stopClip(): void;
};

/**
 * Hands-free: `listening` is the one switch. On, the mic stays open across turns, what the user says
 * is sent when they finish saying it, and Wedyan speaks its answers aloud; talking over it stops it.
 * Off, nothing is heard, and answers are silent.
 *
 * @param devices - What it runs on.
 * @returns `speech`, the dock's whole voice, live: `listening`, `speaking`, `heard` (what's been said
 *   so far of the turn being spoken), `problem` (why listening stopped), `toggle()`, `speak(text)` to
 *   read one thing aloud, and `stop()`; `sync`, to call as the conversation changes; and `played`,
 *   which waits for a part of what's being spoken to finish playing.
 */
export function createHandsFree(devices: HandsFreeDevices) {
  let clipping = false;

  const speech = mutable({
    listening: false,
    speaking: false,
    heard: '',
    problem: '',
    toggle() {
      speech.listening = !speech.listening;
    },
    /** Reads one thing aloud in the user's voice; lasts until it's read or stopped. */
    async speak(text: string) {
      speech.stop();
      clipping = true;
      speech.speaking = true;
      try {
        await devices.clip(text, devices.voiceOf());
      } finally {
        clipping = false;
        speech.speaking = false;
      }
    },
    /** Stops whatever is being spoken; listening carries on. */
    stop() {
      if (clipping) devices.stopClip();
      silence();
    },
  });

  let hearing: HearingCall | undefined;
  let closeMic: (() => void) | undefined;
  let open = false;

  /** Answers already spoken, or that spoke before listening began: they're never spoken again. */
  const past = new Set<string>();
  let messages: ConversationMessage[] = [];
  let speaker: ReturnType<typeof speakAnswer> | undefined;

  const stopSpeaking = () => {
    speaker?.stop();
    speaker = undefined;
    speech.speaking = false;
  };

  /** Lets go of what's being said, and marks everything so far as past: it never resumes. */
  const silence = () => {
    stopSpeaking();
    for (const message of messages) past.add(message.id);
  };

  /** Speaks the oldest answer not yet spoken, one at a time, as the conversation streams it. */
  const speakNext = () => {
    if (!speech.listening) return;
    if (speaker) return speaker.feed();
    const next = messages.find((message): message is AgentMessage => message.role === 'agent' && !past.has(message.id));
    if (!next) return;
    speaker = speakAnswer(next, devices, () => {
      past.add(next.id);
      speaker = undefined;
      speech.speaking = false;
      speakNext();
    });
    speech.speaking = speaker.feed();
  };

  const onHeard = (heard: Heard) => {
    if (heard.type === 'start') {
      silence();
      speech.heard = '';
    } else if (heard.type === 'partial') {
      speech.heard = heard.text;
    } else {
      speech.heard = '';
      if (heard.text.trim()) void devices.send(heard.text);
    }
  };

  const openHearing = () => {
    const call = devices.hear();
    hearing = call;
    call.answer('heard', onHeard);
    call.subscribe(() => {
      if (hearing !== call) return;
      if (call.status === IRPC_STATUS.ERROR) {
        speech.problem = call.error?.message ?? 'Hearing stopped';
        speech.listening = false;
      } else if (call.status === IRPC_STATUS.SUCCESS) {
        // A hearing call has a time limit: the mic stays open, so a new one takes over.
        openHearing();
      }
    });
  };

  const listen = async () => {
    speech.problem = '';
    for (const message of messages) past.add(message.id);
    openHearing();
    try {
      const close = await devices.microphone((pcm) => void hearing?.ask('audio', pcm));
      if (open) closeMic = close;
      else close();
    } catch (error) {
      speech.problem = (error as Error).message;
      speech.listening = false;
    }
  };

  const stopListening = () => {
    closeMic?.();
    closeMic = undefined;
    const call = hearing;
    hearing = undefined;
    call?.close();
    speech.heard = '';
    stopSpeaking();
  };

  subscribe(speech, () => {
    if (speech.listening === open) return;
    open = speech.listening;
    if (open) void listen();
    else stopListening();
  });

  return {
    speech,
    sync(current: ConversationMessage[]) {
      messages = current;
      speakNext();
    },
    played: (part: number) => speaker?.played(part) ?? Promise.resolve(),
  };
}

/**
 * Speaks one answer through a voice call of its own: its spoken text is fed in as it streams, and
 * each part ends once it's complete.
 *
 * @param message - The answer, live.
 * @param devices - What it runs on.
 * @param finished - Called once the answer is written and all of it has played.
 * @returns What feeds it, stops it, and waits on a part of it.
 */
function speakAnswer(message: AgentMessage, devices: HandsFreeDevices, finished: () => void) {
  const sent = new Map<number, number>();
  const ended = new Set<number>();
  const donePlaying = new Set<number>();
  const waiting = new Map<number, (() => void)[]>();
  let call: VoiceCall | undefined;
  let player: Player | undefined;
  let stopped = false;

  const release = (part: number) => {
    for (const resolve of waiting.get(part) ?? []) resolve();
    waiting.delete(part);
  };

  const isOver = () =>
    !['idle', 'running'].includes(message.status) && [...sent.keys()].every((part) => donePlaying.has(part));

  const finishIfOver = () => {
    if (stopped || !isOver()) return;
    stopped = true;
    call?.close();
    finished();
  };

  const open = (): VoiceCall => {
    if (call) return call;
    player = devices.player();
    const opened = devices.voice(devices.voiceOf());
    opened.answer('play', ({ part, audio, last }) => {
      if (!last) return player?.push(audio);
      player?.finish(() => {
        donePlaying.add(part);
        release(part);
        finishIfOver();
      });
    });
    call = opened;
    return opened;
  };

  return {
    /** Feeds in what's new. @returns Whether it has anything to say. */
    feed(): boolean {
      for (const [index, part] of message.parts.entries()) {
        if (part.type !== 'text' || !part.spoken) continue;
        const text = part.text ?? part.chunks.join('');
        const said = sent.get(index) ?? 0;
        if (text.length > said) {
          sent.set(index, text.length);
          open().ask('say', { part: index, text: text.slice(said) });
        }
        if (part.text !== undefined && sent.has(index) && !ended.has(index)) {
          ended.add(index);
          open().ask('end', { part: index });
        }
      }
      finishIfOver();
      return sent.size > 0;
    },
    stop() {
      stopped = true;
      call?.close();
      player?.stop();
      for (const part of waiting.keys()) release(part);
    },
    /** Waits for a part to finish playing; one that isn't spoken has nothing to wait for. */
    played(part: number): Promise<void> {
      if (!sent.has(part) || donePlaying.has(part)) return Promise.resolve();
      return new Promise((resolve) => waiting.set(part, [...(waiting.get(part) ?? []), resolve]));
    },
  };
}
