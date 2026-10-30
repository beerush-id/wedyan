import { createContext } from '@airlib/react';
import type { GenerativeDocument } from '@/lib/documents/types.js';

/**
 * What a generation form works on: a generated image, video or sound by its path, and what making
 * it again and choosing one of its attempts mean where it's shown.
 */
export type GenerationSubject = {
  /** The generated document's path, which its references and casts are written from. */
  readonly path?: string;
  /** The generated document; none while there's nothing to show. */
  readonly source?: GenerativeDocument;
  /** Whether who's in it shows; a persona's own pictures have no one cast in them but the persona. */
  readonly casts?: boolean;
  /** Makes it again, as a new attempt. */
  generate(): void;
  /**
   * Chooses one of its attempts to show.
   *
   * @param id - The attempt's id.
   */
  choose(id: string): void;
};

/** The generated document a view's generation form works on, set by whatever shows it. */
export const generationCtx = createContext<GenerationSubject>();
