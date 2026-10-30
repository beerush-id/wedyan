import { renderVideo, type VideoRenderProgress, type VideoStageAria } from '@airlib/aria';
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny';

/** What a finished render made. */
export type RenderedVideo = { file: Blob; frames: number; seconds: number };

/** How fast and how sharp renders encode: about 8 Mbps suits 1080p. */
const BITRATE = 8_000_000;

/**
 * Renders a composition to an MP4 file: every frame encoded as H.264 — on the graphics hardware
 * where the browser can, which is fastest — and written, in order, into one file in memory that
 * plays anywhere.
 *
 * @param stage - The capturing stage to render, or several on their own timelines to render faster.
 * @param progress - Hears each frame as it is encoded.
 * @param signal - Stops the render.
 * @returns The file, how many frames it holds, and how long rendering took.
 */
export async function renderMp4(
  stage: VideoStageAria | VideoStageAria[],
  progress?: (progress: VideoRenderProgress) => void,
  signal?: AbortSignal
): Promise<RenderedVideo> {
  const started = performance.now();
  const first = Array.isArray(stage) ? stage[0] : stage;
  const frameRate = first.timeline.frameRate;
  const encoder = await h264(first.width, first.height, frameRate);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(video, { frameRate });
  await output.start();

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
    await written;
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
