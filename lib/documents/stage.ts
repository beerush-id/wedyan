import { newHeader, newId } from './paths.js';
import type { MotionDocument, StageDocument } from './types.js';

/** The tracks a stage can be given, by type, and what each is called. */
export const TRACK_NAMES = { video: 'Video', audio: 'Audio', title: 'Title', html: 'HTML' };

export type TrackType = keyof typeof TRACK_NAMES;

/** A stage's size at each aspect ratio a motion is made at. */
const STAGE_SIZES: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/** The tracks a stage starts with, one of each kind: later ones draw over earlier ones. */
const STARTING_TRACKS: TrackType[] = ['audio', 'video', 'html', 'title'];

/**
 * What a new track's clips read until they say otherwise: words have to be set somehow to be seen,
 * so a title track starts with them centred across the stage's middle, in white. Others need nothing.
 *
 * @param type - The kind of track.
 * @param size - The stage's size.
 * @returns The track's values.
 */
export function trackDefaults(type: string | undefined, { width, height }: { width: number; height: number }): Record<string, unknown> {
  if (type !== 'title') return {};
  return {
    x: Math.round(width * 0.1),
    y: Math.round(height * 0.4),
    width: Math.round(width * 0.8),
    height: Math.round(height * 0.2),
    display: 'grid',
    alignItems: 'center',
    textAlign: 'center',
    color: '#ffffff',
    fontSize: Math.round(Math.min(width, height) * 0.08),
    fontWeight: 'bold',
    lineHeight: 1.1,
  };
}

/** The track subtitles sit on: its clips hold only their words, so restyling it restyles them all. */
export const SUBTITLES = 'Subtitles';

/**
 * A subtitle track's values: words low on the stage, on a dim band that keeps them readable over any picture.
 *
 * @param size - The stage's size.
 * @returns The track's values.
 */
export function subtitleAt({ width, height }: { width: number; height: number }): Record<string, unknown> {
  const fontSize = Math.round(Math.min(width, height) * 0.04);
  return {
    x: Math.round(width * 0.08),
    y: Math.round(height * 0.8),
    width: Math.round(width * 0.84),
    height: Math.round(fontSize * 3.2),
    display: 'grid',
    alignItems: 'center',
    textAlign: 'center',
    color: '#ffffff',
    fontSize,
    lineHeight: 1.25,
    background: 'rgba(0, 0, 0, 0.45)',
    borderRadius: Math.round(fontSize * 0.4),
  };
}

/**
 * A new empty stage of a project: its size, its casts, its starting tracks, at 30 frames a second.
 *
 * @param id - Its id, which names its file.
 * @param folder - The folder it goes in.
 * @param name - What it's called.
 * @param project - The project's `.motion`.
 * @param order - Its place in the project.
 * @returns The stage.
 */
export function stageAt(id: string, folder: string, name: string, project: MotionDocument, order: number): StageDocument {
  const size = STAGE_SIZES[project.aspect] ?? STAGE_SIZES['16:9'];
  return {
    ...newHeader(`${folder}/${id}.stage`, '.stage'),
    id,
    name,
    type: 'stage',
    projectId: project.id,
    order,
    casts: [...(project.casts ?? [])],
    composition: {
      id: newId(),
      options: { frameRate: 30 },
      props: size,
      tracks: STARTING_TRACKS.map((type) => ({
        id: newId(),
        options: { type, name: `${TRACK_NAMES[type]} 1`, meta: {} },
        props: trackDefaults(type, size),
        segments: [],
      })),
    },
  };
}

/**
 * How long a composition runs: to the end of its last clip.
 *
 * @param composition - The composition.
 * @returns Its length, in seconds.
 */
export const runtime = (composition: StageDocument['composition']): number =>
  Math.max(
    0,
    ...composition.tracks.flatMap((track) =>
      track.segments.map((segment) => segment.options.startFrame / composition.options.frameRate + segment.options.duration),
    ),
  );

/**
 * A stage's poster: the picture of its first clip that has one.
 *
 * @param stage - The stage.
 * @returns The picture's address, if any clip has one.
 */
export const posterOf = (stage: StageDocument): string | undefined => {
  for (const track of stage.composition.tracks) {
    for (const segment of track.segments) {
      const thumbnail = segment.options.meta?.thumbnail;
      if (typeof thumbnail === 'string') return thumbnail;
    }
  }
};
