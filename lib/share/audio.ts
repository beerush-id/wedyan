import { HEAR_RATE, SPEECH_TYPE } from '@/lib/speech/speech.h.js';

/** How much mic audio goes in one frame, in samples: about 80 ms, as hearing takes it. */
const FRAME_SAMPLES = Math.round(HEAR_RATE * 0.08);

/** How much speech is raised: the model's peaks reach only about a third of full scale. */
const SPEECH_GAIN = 2.5;

/** Where the limiter takes over, in dB: a raised peak is held down here rather than clipped. */
const LIMIT_AT = -3;

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
  /** Plays base64 speech after what's already queued. */
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
 * Creates a player for one answer's speech. Each sentence comes as a whole recording, so one element
 * plays them in turn, as they arrive.
 *
 * @param rate - How fast it plays, as a multiple of the speech's own pace.
 * @returns The player.
 */
export function createPlayer(rate = 1): Player {
  const audio = new Audio();
  // The default too: loading a source resets the rate to it.
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  const release = playInStereo(audio);

  type Queued = { speech: string } | { played: () => void };
  const queue: Queued[] = [];
  let playing = false;

  /** Plays what's queued, one recording at a time; a wait is over once all before it has played. */
  const next = () => {
    while (!playing && queue.length) {
      const item = queue.shift() as Queued;
      if ('played' in item) {
        item.played();
        continue;
      }
      playing = true;
      audio.src = `data:${SPEECH_TYPE};base64,${item.speech}`;
      void audio.play();
    }
  };

  const ended = () => {
    playing = false;
    next();
  };
  audio.addEventListener('ended', ended);
  // A recording that can't play must not hold back the ones after it.
  audio.addEventListener('error', ended);

  return {
    push(speech) {
      queue.push({ speech });
      next();
    },
    finish(played) {
      queue.push({ played });
      next();
    },
    stop() {
      const waiting = queue.splice(0);
      audio.pause();
      audio.removeAttribute('src');
      release();
      for (const item of waiting) if ('played' in item) item.played();
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
    const release = playInStereo(element);
    const ended = () => {
      release();
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

/** Where speech plays. */
let output: AudioContext | undefined;

/**
 * Plays speech in both speakers, raised to a normal level. Speech is one channel, and on a surround
 * output one channel goes to the center alone, which a desk's two speakers don't have: heard as
 * nothing at all.
 *
 * @param element - What's playing.
 * @returns What lets go of it.
 */
function playInStereo(element: HTMLAudioElement): () => void {
  output ??= new AudioContext();
  void output.resume();
  const source = output.createMediaElementSource(element);
  const both = new GainNode(output, {
    gain: SPEECH_GAIN,
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const limiter = new DynamicsCompressorNode(output, { threshold: LIMIT_AT, knee: 0, ratio: 20 });
  source.connect(both).connect(limiter).connect(output.destination);

  return () => {
    source.disconnect();
    both.disconnect();
    limiter.disconnect();
  };
}

/** Bytes as Base64, a slice at a time so a long frame never overflows the call stack. */
function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
