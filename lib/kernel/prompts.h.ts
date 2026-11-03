import { z } from 'zod';
import { kernel } from './package.js';

/** How long writing a prompt may take, in ms: a model reads everything the picture is made from. */
const WRITING_TIMEOUT = 90_000;

/**
 * Writes the prompt a still or a take is made from, from what it's made from: its draft, who's in
 * it, its references and its project's art style, each named so the picture comes out consistent.
 * Nothing is kept: the form puts the words in its prompt, to read before anything is generated.
 */
export const promptWrite = kernel.declare<(path: string, draft: string) => Promise<string>>({
  name: 'prompt.write',
  timeout: WRITING_TIMEOUT,
  schema: {
    input: [z.string().min(1).max(1024), z.string().max(4000)],
  },
});
