import type { StageDocument } from './types.js';

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
