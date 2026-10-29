import {
  type AudioOutput,
  type ComposeOptions,
  createAI,
  type ImageOptions,
  type ImageOutput,
  type VideoOptions,
  type VideoOutput,
} from '@irpclib/ai-kit';
import type { IRPCReader } from '@irpclib/irpc';

/** Where the desktop reaches ai-kit on Wedyan's own server, scoped to the session like every call. */
export const AI_ENDPOINT = '/irpc-ai';

/** Wedyan's ai-kit: the models the server runs, for the desktop's own generation. */
export const ai = createAI({ name: 'wedyan-ai', endpoint: AI_ENDPOINT });

/**
 * What Wedyan adds to a generation call: `saveTo`, the folder in the user's drive the result is
 * kept in, as a full path (`~/Motions/Lantern short/Hero`). The file is named by the output's id,
 * and the output's `url` is its path. Without it, the result is the provider's own link.
 */
export type SavedOptions = { saveTo?: string };

/** Draws an image, kept in the drive when the call says where. */
export const draw = ai.draw as (options: ImageOptions & SavedOptions) => IRPCReader<ImageOutput>;

/** Films a video, kept in the drive when the call says where. */
export const film = ai.film as (options: VideoOptions & SavedOptions) => IRPCReader<VideoOutput>;

/** Composes audio (music, sound effects, ambience), kept in the drive when the call says where. */
export const compose = ai.compose as (input: ComposeOptions & SavedOptions) => IRPCReader<AudioOutput>;
