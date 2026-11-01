import { isSegmentMuted, renderVideo, sampleSegment, type VideoMediaLoader, type VideoRenderProgress, type VideoStageAria } from '@airlib/aria';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import {
  AudioBufferSource,
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  getFirstEncodableAudioCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from 'mediabunny';
import type { ClipSound } from './composition.js';

/** What a finished render made. */
export type RenderedVideo = { file: Blob; frames: number; seconds: number };

/** How fast and how sharp renders encode: about 8 Mbps suits 1080p. */
const BITRATE = 8_000_000;

/** A render's sound: stereo at the rate video is made at. */
const SOUND = { numberOfChannels: 2, sampleRate: 48_000 };

/** The kinds of clip that have sound. */
const SOUNDING = new Set(['video', 'audio']);

/**
 * Renders a composition to an MP4 file: every frame encoded as H.264 — on the graphics hardware
 * where the browser can, which is fastest — and its clips' sound mixed down, written, in order,
 * into one file in memory that plays anywhere.
 *
 * @param stage - The capturing stage to render.
 * @param media - Opens the media its clips name, for their sound.
 * @param progress - Hears each frame as it is encoded.
 * @param signal - Stops the render.
 * @returns The file, how many frames it holds, and how long rendering took.
 */
export async function renderMp4(
  stage: VideoStageAria,
  media: VideoMediaLoader,
  progress?: (progress: VideoRenderProgress) => void,
  signal?: AbortSignal
): Promise<RenderedVideo> {
  const started = performance.now();
  const frameRate = stage.timeline.frameRate;
  const encoder = await h264(stage.width, stage.height, frameRate);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(video, { frameRate });

  const sound = await mixSound(stage.timeline, media);
  const codec = sound && (await getFirstEncodableAudioCodec(['aac', 'opus'], { ...SOUND, quality: QUALITY_HIGH }));
  const audio = codec ? new AudioBufferSource({ codec, quality: QUALITY_HIGH }) : undefined;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  // The muxer weaves the tracks together, so the sound goes in alongside the frames, not after them.
  const heard = sound && audio?.add(sound);

  // The muxer takes packets one at a time, in the order they were encoded.
  let written: Promise<void> = Promise.resolve();
  let frames = 0;

  try {
    await renderVideo({
      stage,
      signal,
      encoder,
      output: (chunk, meta) => {
        written = written.then(() => video.add(EncodedPacket.fromEncodedChunk(chunk), meta));
      },
      progress: (state) => {
        frames = state.done;
        progress?.(state);
      },
    });
    await Promise.all([written, heard]);
    await output.finalize();
  } catch (error) {
    await output.cancel();
    throw error;
  }

  return {
    file: new Blob([target.buffer as ArrayBuffer], { type: 'video/mp4' }),
    frames,
    seconds: (performance.now() - started) / 1000,
  };
}

/**
 * Mixes a timeline's sound down to one buffer, each clip as the stage plays it: from where it's
 * trimmed, for as long as its segment runs, unless it or its track is muted, at the volume and
 * balance it has at each frame.
 *
 * @param timeline - The timeline.
 * @param media - Opens the media its clips name.
 * @returns The mix, the length of the render; nothing when no clip has sound.
 */
export async function mixSound(timeline: Timeline, media: VideoMediaLoader): Promise<AudioBuffer | undefined> {
  const { frameRate } = timeline;
  const from = Math.max(0, timeline.startFrame ?? 0);
  const to = Math.max(from, timeline.endFrame ?? timeline.totalFrames);
  const length = Math.ceil(((to - from + 1) / frameRate) * SOUND.sampleRate);
  const mix = new OfflineAudioContext(SOUND.numberOfChannels, length, SOUND.sampleRate);
  const secondsAt = (frame: number) => Math.max(0, (frame - from) / frameRate);

  let voices = 0;
  for (const track of timeline.tracks) {
    for (const segment of track.segments as Iterable<TimelineSegment<ClipSound & { src?: string }>>) {
      const { src, muted, volume = 1, pan = 0 } = segment.props;
      if (!src || muted || !SOUNDING.has(segment.type ?? '') || isSegmentMuted(segment)) continue;
      const sound = await (await media(src).catch(() => undefined))?.sound?.();
      if (!sound) continue;

      const node = mix.createBufferSource();
      const panner = mix.createStereoPanner();
      const gain = mix.createGain();
      node.buffer = sound;
      node.connect(panner).connect(gain).connect(mix.destination);
      for (let frame = segment.startFrame; frame <= segment.endFrame; frame++) {
        const levels = sampleSegment(segment, frame) as ClipSound;
        gain.gain.setValueAtTime(levels.volume ?? volume, secondsAt(frame));
        panner.pan.setValueAtTime(levels.pan ?? pan, secondsAt(frame));
      }
      const first = Math.max(from, segment.startFrame);
      const offset = (first - segment.startFrame + segment.offsetFrame) / frameRate;
      node.start(secondsAt(first), offset, (segment.endFrame + 1 - first) / frameRate);
      voices += 1;
    }
  }

  return voices ? mix.startRendering() : undefined;
}

/**
 * The H.264 encoder settings for a size: High profile at the level the size needs, on the graphics
 * hardware when the browser has it there, otherwise in software.
 *
 * @param width - Frame width, in pixels.
 * @param height - Frame height, in pixels.
 * @param frameRate - Frames per second.
 * @returns Settings `renderVideo` can encode with.
 */
async function h264(width: number, height: number, frameRate: number): Promise<Partial<VideoEncoderConfig>> {
  // Level 4.0 carries 1080p at 30 frames a second; anything bigger needs 5.1.
  const codec = width * height <= 1920 * 1080 && frameRate <= 30 ? 'avc1.640028' : 'avc1.640033';
  const base = { codec, width, height, framerate: frameRate, bitrate: BITRATE, avc: { format: 'avc' as const } };

  const hardware = { ...base, hardwareAcceleration: 'prefer-hardware' as const };
  const supported = await VideoEncoder.isConfigSupported(hardware).catch(() => ({ supported: false }));
  return supported.supported ? hardware : base;
}
