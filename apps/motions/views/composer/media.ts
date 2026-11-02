import type { VideoMedia, VideoMediaLoader } from '@airlib/aria';
import { mutable } from '@airlib/react';
import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  type ConversionVideoOptions,
  Input,
  type InputVideoTrack,
  Mp4OutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  UrlSource,
  type WrappedCanvas,
} from 'mediabunny';
import { PICTURE_FILE } from '@/lib/documents/generation.js';

/** How media is opened: whether its scrubbing copy is made as soon as it's opened. */
export type MediaLoaderOptions = {
  /**
   * Buffers each file with pictures as it's opened: a copy in memory that looks as the file does —
   * its own size, at very high quality — but with a keyframe every moment, which the clips then
   * read every picture from, so what plays is what renders, and jumping anywhere, backward too,
   * decodes almost nothing. Its progress shows in `buffers`. Sound and length still come from the
   * file itself; leave it off where the pictures must be the file's own, e.g. to render.
   */
  autobuffer?: boolean;
};

/** Where buffering a file stands: under way, with how far along, from 0 to 1; done; or failed. */
export type MediaBuffer = { status: 'buffering' | 'ready' | 'failed'; progress: number };

/** Each file's buffering, by its address, while it's under way and after: what clips show as buffering. */
export const buffers = mutable<Record<string, MediaBuffer>>({});

/**
 * How far ahead, in seconds, a picture may be asked for and still be read on from the last one;
 * further, or behind it, the reader seeks there instead.
 */
const READ_AHEAD = 1;

/** How many decoded pictures a reader keeps: the one shown, the next, and one in hand. */
const POOL = 3;

/** How far apart, in seconds, a buffered copy's keyframes are: the most it ever decodes to land on a moment. */
const BUFFER_KEYFRAMES = 0.5;

/**
 * A file every clip naming it shares: opened once, its length and pictures' track known, its sound
 * decoded once when asked, and its buffered copy's track once made.
 */
type MediaFile = {
  input: Input;
  duration: number;
  video?: InputVideoTrack;
  sound?: Promise<AudioBuffer | undefined>;
  buffering?: Promise<void>;
  buffered?: InputVideoTrack;
};

/** Each file opened, by its address. */
const FILES = new Map<string, Promise<MediaFile | undefined>>();

/** Each picture read, by its address. Every clip of it shows this one, so none lets go of it. */
const PICTURES = new Map<string, Promise<ImageBitmap | undefined>>();

/**
 * A loader for the stage, decoding media with mediabunny: each clip gets the file's length, its
 * pictures — read on its own, so two clips of one file never pull each other back and forth, and
 * from the buffered copy once there is one — and its sound, decoded once for every clip of the file.
 *
 * @param options - Whether files are buffered as they open.
 * @returns The loader.
 */
export function mediaLoader(options: MediaLoaderOptions = {}): VideoMediaLoader {
  return async (src) => {
    if (PICTURE_FILE.test(src)) return openPicture(src);
    const file = await openFile(src);
    if (!file) return;
    if (options.autobuffer && file.video) bufferFile(src, file);

    // The clip reads its pictures from the file until its buffered copy is made, then from the copy.
    let reader: ReturnType<typeof readFrames> | undefined;
    let fromBuffer = false;
    const pictures = () => {
      const buffered = options.autobuffer ? file.buffered : undefined;
      if (reader && (fromBuffer || !buffered)) return reader;
      reader?.dispose();
      fromBuffer = !!buffered;
      const track = buffered ?? file.video;
      reader = track ? readFrames(new CanvasSink(track, { poolSize: POOL })) : undefined;
      return reader;
    };

    return {
      duration: file.duration,
      frame: file.video ? (time, signal) => pictures()?.frame(time, signal) ?? Promise.resolve(undefined) : undefined,
      sound: () => (file.sound ??= decodeSound(file.input)),
      dispose: () => reader?.dispose(),
    };
  };
}

/**
 * A picture as a clip's media: the same picture at every moment, so a take can rehearse on a still
 * and be given its video later, in the same clip. It has no length of its own, so it runs as long as
 * its clip does.
 *
 * @param src - Where it is.
 * @returns The media, or nothing when it can't be read.
 */
async function openPicture(src: string): Promise<VideoMedia | undefined> {
  const picture = await readPicture(src);
  return picture && { duration: 0, frame: async () => picture };
}

/**
 * A picture by its address, read once however many clips show it. One that can't be read isn't
 * kept, so the next clip tries again.
 *
 * @param src - Where it is.
 * @returns The picture, or nothing when it can't be read.
 */
function readPicture(src: string): Promise<ImageBitmap | undefined> {
  let reading = PICTURES.get(src);
  if (!reading) {
    reading = (async () => {
      const response = await fetch(src);
      return response.ok ? createImageBitmap(await response.blob()) : undefined;
    })().catch(() => undefined);
    PICTURES.set(src, reading);
    void reading.then((picture) => picture ?? PICTURES.delete(src));
  }
  return reading;
}

/**
 * A file by its address, opened once however many clips name it.
 *
 * @param src - Where it is.
 * @returns The file, or nothing when it can't be read.
 */
function openFile(src: string): Promise<MediaFile | undefined> {
  let opening = FILES.get(src);
  if (!opening) {
    opening = (async () => {
      const input = new Input({ source: new UrlSource(src), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      const video = track && (await track.canDecode()) ? track : undefined;
      return { input, duration: await input.computeDuration(), video };
    })().catch(() => undefined);
    FILES.set(src, opening);
  }
  return opening;
}

/**
 * How a buffered copy is encoded, in the order tried: H.264 first, the standard, decoded by the
 * hardware nearly everywhere; VP9 where H.264 can't be made. H.264 is encoded in software, since
 * Chrome's hardware encoder turns down a keyframe every moment at this quality; encoding happens
 * once per file, while decoding it, each time it's watched, stays with the hardware.
 */
const BUFFER_ENCODINGS: ConversionVideoOptions[] = [
  { codec: 'avc', hardwareAcceleration: 'prefer-software' },
  { codec: 'vp9' },
];

/**
 * Makes a file's buffered copy, once, in the background: its pictures only, at their own size and
 * very high quality, with a keyframe every `BUFFER_KEYFRAMES`, held in memory, in the first of
 * `BUFFER_ENCODINGS` the browser can make. How far along it is shows in `buffers`; once made,
 * every clip of the file reads from it.
 *
 * @param src - The file's address, which its progress is kept under.
 * @param file - The file.
 */
function bufferFile(src: string, file: MediaFile): void {
  if (file.buffering || !file.video) return;
  // One entry for the file, its fields changed in place: replacing it at every report would hand
  // whatever shows it a new state to watch each time.
  buffers[src] = { status: 'buffering', progress: 0 };
  const buffer = buffers[src];

  file.buffering = (async () => {
    for (const encoding of BUFFER_ENCODINGS) {
      buffer.progress = 0;
      const copy = await encodeCopy(file, encoding, buffer).catch(() => undefined);
      if (!copy) continue;
      file.buffered = (await copy.getPrimaryVideoTrack()) ?? undefined;
      if (file.buffered) break;
    }
    buffer.progress = file.buffered ? 1 : 0;
    buffer.status = file.buffered ? 'ready' : 'failed';
  })();
}

/**
 * Encodes a file's buffered copy one way, writing its progress onto its buffer entry once per
 * whole percent — the encoder reports every frame, more often than anyone can see.
 *
 * @param file - The file.
 * @param encoding - The codec, and how to encode it.
 * @param buffer - The file's entry in `buffers`.
 * @returns The copy, opened; it fails when the browser can't encode it that way.
 */
async function encodeCopy(file: MediaFile, encoding: ConversionVideoOptions, buffer: MediaBuffer): Promise<Input> {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const conversion = await Conversion.init({
    input: file.input,
    output,
    video: { keyFrameInterval: BUFFER_KEYFRAMES, quality: QUALITY_VERY_HIGH, ...encoding },
    audio: { discard: true },
  });
  if (!conversion.isValid) throw new Error("The file can't be buffered this way.");
  conversion.onProgress = (progress) => {
    const percent = Math.floor(progress * 100) / 100;
    if (percent !== buffer.progress) buffer.progress = percent;
  };
  await conversion.execute();
  return new Input({ source: new BlobSource(new Blob([target.buffer as ArrayBuffer])), formats: ALL_FORMATS });
}

/**
 * A clip's pictures, read in order as the timeline plays: asked for a moment shortly after the
 * last, it reads on to it; further away or behind, it seeks there. Requests are taken one at a
 * time, and one aborted while waiting its turn is dropped.
 *
 * @param sink - The video track's decoder, as canvases.
 * @returns How to get the picture at a moment, and to let go of the reading.
 */
function readFrames(sink: CanvasSink): Required<Pick<VideoMedia, 'frame' | 'dispose'>> {
  let reading: AsyncGenerator<WrappedCanvas, void, unknown> | undefined;
  let current: WrappedCanvas | undefined;
  let upcoming: WrappedCanvas | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const next = async () => ((await reading?.next())?.value ?? undefined) as WrappedCanvas | undefined;

  const read = async (time: number) => {
    if (!reading || !current || time < current.timestamp || time - current.timestamp > READ_AHEAD) {
      await reading?.return();
      reading = sink.canvases(Math.max(0, time));
      current = await next();
      upcoming = undefined;
    }
    while (current) {
      upcoming ??= await next();
      if (!upcoming || upcoming.timestamp > time) break;
      current = upcoming;
      upcoming = undefined;
    }
    return current?.canvas;
  };

  return {
    frame(time, signal) {
      const run = queue.then(() => (signal?.aborted ? undefined : read(time)));
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() {
      void reading?.return();
      reading = undefined;
    },
  };
}

/**
 * A file's sound, decoded whole into one buffer, its pieces laid at their own times.
 *
 * @param input - The file.
 * @returns Its sound, or nothing when it has none it can decode.
 */
async function decodeSound(input: Input): Promise<AudioBuffer | undefined> {
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return;

  const pieces: { buffer: AudioBuffer; timestamp: number }[] = [];
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) pieces.push({ buffer, timestamp });
  const [first] = pieces;
  if (!first) return;

  const { sampleRate, numberOfChannels } = first.buffer;
  const length = Math.ceil(Math.max(...pieces.map((piece) => piece.timestamp * sampleRate + piece.buffer.length)));
  const whole = new AudioBuffer({ length, numberOfChannels, sampleRate });
  for (const piece of pieces) {
    const at = Math.max(0, Math.round(piece.timestamp * sampleRate));
    for (let channel = 0; channel < numberOfChannels; channel++) {
      whole.copyToChannel(piece.buffer.getChannelData(channel).subarray(0, Math.max(0, length - at)), channel, at);
    }
  }
  return whole;
}
