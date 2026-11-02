import { newHeader } from './paths.js';
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
  return {
    ...newHeader(`${folder}/${id}.stage`, '.stage'),
    id,
    name,
    type: 'stage',
    projectId: project.id,
    order,
    casts: [...(project.casts ?? [])],
    composition: {
      id: crypto.randomUUID(),
      options: { frameRate: 30 },
      props: STAGE_SIZES[project.aspect] ?? STAGE_SIZES['16:9'],
      tracks: STARTING_TRACKS.map((type) => ({
        id: crypto.randomUUID(),
        options: { type, name: `${TRACK_NAMES[type]} 1`, meta: {} },
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
