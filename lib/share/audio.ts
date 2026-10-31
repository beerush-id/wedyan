import { HEAR_RATE } from '@/lib/speech/speech.h.js';

/** How much mic audio goes in one frame, in samples: about 80 ms, as hearing takes it. */
const FRAME_SAMPLES = Math.round(HEAR_RATE * 0.08);

/** How close to a part's end counts as played: playback can stop just short of what was buffered. */
const PLAYED_MARGIN = 0.15;

/** The audio thread: turns the mic's samples into frames of signed 16-bit PCM. */
const MIC_WORKLET = `class WedyanMic extends AudioWorkletProcessor {
  frame = new Int16Array(${FRAME_SAMPLES});
  at = 0;
  process([input]) {
    for (const sample of input[0] ?? []) {
      this.frame[this.at++] = Math.max(-32768, Math.min(32767, sample * 32768));
      if (this.at === this.frame.length) {
        this.port.postMessage(this.frame.slice().buffer);
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor('wedyan-mic', WedyanMic);`;

/** Plays one answer's speech as it arrives. */
export type Player = {
  /** Plays base64 MP3 after what's already queued. */
  push(audio: string): void;
  /** Calls `played` once everything pushed so far has played. */
  finish(played: () => void): void;
  /** Stops at once, mid-word if need be. */
  stop(): void;
};

/**
 * Opens the mic and sends its audio as hearing takes it: base64 PCM, 16-bit, mono, in frames of about
 * 80 ms. Echo cancellation is on, since hands-free the mic stays open while Wedyan speaks through the
 * desk's speakers, and without it Wedyan would hear itself and stop.
 *
 * @param onFrame - Receives each frame.
 * @returns What closes the mic.
 */
export async function openMicrophone(onFrame: (pcm: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new AudioContext({ sampleRate: HEAR_RATE });
  await context.audioWorklet.addModule(URL.createObjectURL(new Blob([MIC_WORKLET], { type: 'text/javascript' })));
  const source = context.createMediaStreamSource(stream);
  const mic = new AudioWorkletNode(context, 'wedyan-mic');
  mic.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => onFrame(base64Of(new Uint8Array(data)));
  source.connect(mic);
  await context.resume();

  return () => {
    mic.port.onmessage = null;
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };
}

/**
 * Creates a player for one answer's speech: its MP3 is appended to one Media Source buffer, so it
 * plays as it comes with no gap between chunks.
 *
 * @param rate - How fast it plays, as a multiple of the speech's own pace.
 * @returns The player.
 */
export function createPlayer(rate = 1): Player {
  const audio = new Audio();
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  // The default too: loading the source resets the rate to it.
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  audio.src = url;

  type Queued = { bytes: Uint8Array } | { played: () => void };
  const queue: Queued[] = [];
  const waiting: { at: number; played: () => void }[] = [];
  let buffer: SourceBuffer | undefined;

  /** Appends what's queued, one piece at a time, as a source buffer takes it. */
  const pump = () => {
    while (buffer && !buffer.updating && queue.length) {
      const next = queue.shift() as Queued;
      if ('bytes' in next) {
        buffer.appendBuffer(next.bytes as BufferSource);
        return;
      }
      const end = buffer.buffered.length ? buffer.buffered.end(buffer.buffered.length - 1) : 0;
      waiting.push({ at: end, played: next.played });
      settle();
    }
  };

  /** Tells whoever waits on what has now played. */
  const settle = () => {
    while (waiting.length && audio.currentTime >= waiting[0].at - PLAYED_MARGIN) waiting.shift()?.played();
  };

  source.addEventListener('sourceopen', () => {
    buffer = source.addSourceBuffer('audio/mpeg');
    buffer.addEventListener('updateend', pump);
    pump();
  });
  audio.addEventListener('timeupdate', settle);
  // Playback that ran out of audio stops short of its end, and may never reach it.
  audio.addEventListener('waiting', settle);
  void audio.play();

  return {
    push(chunk) {
      queue.push({ bytes: bytesOf(chunk) });
      pump();
    },
    finish(played) {
      queue.push({ played });
      pump();
    },
    stop() {
      queue.length = 0;
      audio.pause();
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      for (const { played } of waiting.splice(0)) played();
    },
  };
}

/** The clip playing, and what ends it. */
let clip: { audio: HTMLAudioElement; ended: () => void } | undefined;

/**
 * Plays one whole clip, in place of any playing.
 *
 * @param audio - The clip, base64.
 * @param type - Its media type.
 * @param rate - How fast it plays, as a multiple of the speech's own pace.
 * @returns Once it has played, or stopped.
 */
export function playClip(audio: string, type: string, rate = 1): Promise<void> {
  stopClip();
  return new Promise((resolve) => {
    const element = new Audio(`data:${type};base64,${audio}`);
    element.defaultPlaybackRate = rate;
    element.playbackRate = rate;
    const ended = () => {
      clip = undefined;
      resolve();
    };
    element.addEventListener('ended', ended);
    element.addEventListener('error', ended);
    clip = { audio: element, ended };
    void element.play();
  });
}

/** Stops the clip playing, if any. */
export function stopClip(): void {
  clip?.audio.pause();
  clip?.ended();
}

/** Bytes as Base64, a slice at a time so a long frame never overflows the call stack. */
function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** Base64 as bytes. */
function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
