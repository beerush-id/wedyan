import { z } from 'zod';
import type { CastPictures, GeneratedAttempt } from '@/lib/documents/types.js';
import { kernel } from './package.js';

/** What a still is made from: its prompt, how it's made, and the images it's made from. */
export type StillRequest = {
  prompt: string;
  /** The model tier, the aspect ratio, and how many images one request makes. */
  settings?: { model?: string; aspect?: string; batch?: number };
  /** Images it's made from: a `.still` (its chosen image), a picture, by path from the still, or an address. */
  references?: string[];
  /** Who's in it, by path to each `.persona`: their pictures go to the model with the references. */
  casts?: string[];
  /** Which of their pictures go; someone with no entry goes by their defaults. */
  castPictures?: CastPictures;
};

/** A new attempt of a still, and an address to show it at. */
export type StillAttempt = GeneratedAttempt & { url: string };

/** How long making a still's pictures may take, in ms: a model draws for well over a quick call's wait. */
const GENERATION_TIMEOUT = 180_000;

/**
 * What a still can be described for: `face`, who it shows, to draw them again in another picture,
 * and their expression as drawn, to adjust it; `subject`, what it shows (who or what, framed and posed how, where), to understand what's asked
 * of it.
 */
export const DESCRIPTION_TYPES = ['face', 'subject'] as const;

/** What a still is described for. */
export type DescriptionType = (typeof DESCRIPTION_TYPES)[number];

/** How a still is described. */
export type DescribeOptions = { type: DescriptionType };

/**
 * Makes new attempts of a still from what it's made from, kept beside it; they aren't in the still
 * yet: the window that asked adds them to its copy, which it saves with its own edits.
 */
export const stillAttempts = kernel.declare<(path: string, request: StillRequest) => Promise<StillAttempt[]>>({
  name: 'still.attempts',
  timeout: GENERATION_TIMEOUT,
  schema: {
    input: [
      z.string().min(1).max(1024),
      z.object({
        prompt: z.string().min(1).max(4000),
        settings: z.object({ model: z.string(), aspect: z.string(), batch: z.number().int() }).partial().optional(),
        references: z.array(z.string().max(2048)).max(8).optional(),
        casts: z.array(z.string().max(2048)).max(8).optional(),
        castPictures: z.record(z.string().max(2048), z.array(z.string().max(2048)).max(16)).optional(),
      }),
    ],
  },
});

/**
 * Describes a still's chosen image in words, for one purpose, so whoever works on it later reads
 * what it shows instead of looking at it. Nothing is kept: the app keeps the words where it needs
 * them.
 */
export const stillDescribe = kernel.declare<(path: string, options: DescribeOptions) => Promise<string>>({
  name: 'still.describe',
  schema: {
    input: [z.string().min(1).max(1024), z.object({ type: z.enum(DESCRIPTION_TYPES) })],
  },
});
