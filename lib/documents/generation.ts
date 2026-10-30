import { follow } from './store.js';
import type { DocumentType, GeneratedAttempt, GenerationSettings, GenerativeDocument, WedyanDocument } from './types.js';

/** The models a generation can be asked of, by what it makes. Placeholders until the kernel names its own. */
export const MODELS: Record<GenerativeDocument['type'], Record<string, string>> = {
  still: { standard: 'Standard', detailed: 'Detailed' },
  take: { standard: 'Standard', cinematic: 'Cinematic' },
  sound: { standard: 'Standard', voice: 'Voice' },
};

/** The models writing — a script, a persona's personality — can be asked of. Placeholders until the kernel names its own. */
export const WRITING_MODELS = { fast: 'Fast', balanced: 'Balanced', best: 'Best' };

/** The aspect ratios a picture can be made at. */
export const ASPECTS = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1' };

/** What a generation is made with when its document doesn't say. */
const DEFAULT_SETTINGS: Required<GenerationSettings> = { model: 'standard', aspect: '16:9', seconds: 4, batch: 2 };

/** The document types that are generated, and made again from their prompt. */
const GENERATIVE_TYPES = new Set<DocumentType>(['still', 'take', 'sound']);

/**
 * Whether a document is a generated image, video or sound.
 *
 * @param document - The document, if there is one.
 * @returns Whether it's generative.
 */
export function isGenerative(document?: WedyanDocument): document is GenerativeDocument {
  return !!document && GENERATIVE_TYPES.has(document.type);
}

/**
 * A generated document's settings as values a field binds to: each reads the document's own, or
 * what it's made with when it doesn't say, and writes onto the document.
 *
 * @param source - The generated document.
 * @returns Its model, aspect ratio, seconds and batch size, read from and written to the document.
 */
export function settingsOf(source: GenerativeDocument): Required<GenerationSettings> {
  const settings = () => (source.settings ??= {}) as GenerationSettings;
  return {
    get model() {
      return source.settings?.model ?? DEFAULT_SETTINGS.model;
    },
    set model(model: string) {
      settings().model = model;
    },
    get aspect() {
      return (source.settings as GenerationSettings | undefined)?.aspect ?? DEFAULT_SETTINGS.aspect;
    },
    set aspect(aspect: string) {
      settings().aspect = aspect;
    },
    get seconds() {
      return (source.settings as GenerationSettings | undefined)?.seconds ?? DEFAULT_SETTINGS.seconds;
    },
    set seconds(seconds: number) {
      settings().seconds = seconds;
    },
    get batch() {
      return (source.settings as GenerationSettings | undefined)?.batch ?? DEFAULT_SETTINGS.batch;
    },
    set batch(batch: number) {
      settings().batch = batch;
    },
  };
}

/**
 * Makes a generated document ask again what one of its attempts was made with: its prompt, and its
 * settings over the document's own. Its batch size stays the document's, since no attempt has one.
 *
 * @param source - The generated document.
 * @param attempt - The attempt to make again from.
 */
export function reuseAttempt(source: GenerativeDocument, attempt: GeneratedAttempt): void {
  source.prompt = attempt.prompt;
  source.settings = { ...source.settings, ...attempt.settings };
}

/**
 * A generated document's chosen attempt, or its first when the choice is gone.
 *
 * @param source - The generated document.
 * @returns The attempt it shows.
 */
export function chosenAttempt<T extends GenerativeDocument>(source: T): T['attempts'][number] | undefined {
  return source.attempts.find((attempt) => attempt.id === source.chosen) ?? source.attempts[0];
}

/**
 * An attempt's picture: a still's own, a take's poster; a sound has none.
 *
 * @param source - The generated document.
 * @param attempt - One of its attempts.
 * @returns Its picture's address, if it has one.
 */
export function attemptPicture(source: GenerativeDocument, attempt?: GenerativeDocument['attempts'][number]): string | undefined {
  if (!attempt || source.type === 'sound') return;
  return source.type === 'still' ? attempt.src : (attempt as { poster?: string }).poster;
}

/**
 * The picture a written path or address shows: a still's chosen attempt, a take's poster, a
 * persona's face, or the address itself when it's no document.
 *
 * @param from - The path of the document it's written in.
 * @param reference - The path or address, as written.
 * @returns Its picture's address, if it has one.
 */
export function pictureAt(from: string, reference: string): string | undefined {
  const found = follow(from, reference);
  const document = found.document;
  if (!document) return reference;
  if (isGenerative(document)) return attemptPicture(document, chosenAttempt(document));
  if (document.type === 'persona') return document.head?.main && pictureAt(found.path, document.head.main);
}
