import { z } from 'zod';
import type { GeneratedAttempt } from '@/lib/documents/types.js';
import { kernel } from './package.js';

/** What a still is made from: its prompt, how it's made, and the images it's made from. */
export type StillRequest = {
  prompt: string;
  /** The model tier, the aspect ratio, and how many images one request makes. */
  settings?: { model?: string; aspect?: string; batch?: number };
  /** Images it's made from: a `.still` (its chosen image), a picture, by path from the still, or an address. */
  references?: string[];
};

/** A new attempt of a still, and an address to show it at. */
export type StillAttempt = GeneratedAttempt & { url: string };

/**
 * Makes new attempts of a still from what it's made from, kept beside it; they aren't in the still
 * yet: the window that asked adds them to its copy, which it saves with its own edits.
 */
export const stillAttempts = kernel.declare<(path: string, request: StillRequest) => Promise<StillAttempt[]>>({
  name: 'still.attempts',
  schema: {
    input: [
      z.string().min(1).max(1024),
      z.object({
        prompt: z.string().min(1).max(4000),
        settings: z.object({ model: z.string(), aspect: z.string(), batch: z.number().int() }).partial().optional(),
        references: z.array(z.string().max(2048)).max(8).optional(),
      }),
    ],
  },
});
