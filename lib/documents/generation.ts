import { follow } from '../share/documents.js';
import { pathFrom } from '../share/paths.js';
import type { DocumentType, GeneratedAttempt, GenerationMode, GenerationSettings, GenerativeDocument, WedyanDocument } from './types.js';

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
const DEFAULT_SETTINGS: Required<GenerationSettings> = { mode: 'image', model: 'standard', aspect: '16:9', seconds: 4, batch: 2 };

/** What a take's Generate can make: pictures first, since a video costs far more to get wrong. */
export const GENERATION_MODES = { image: 'Image', video: 'Video' };

/** What's a picture rather than footage, by its address: a take can hold either as an attempt. */
export const PICTURE_FILE = /\.(webp|png|jpe?g|avif)(\?|$)/i;

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
 * @returns Its mode, model, aspect ratio, seconds and batch size, read from and written to the document.
 */
export function settingsOf(source: GenerativeDocument): Required<GenerationSettings> {
  const settings = () => (source.settings ??= {}) as GenerationSettings;
  return {
    get mode() {
      return (source.settings as GenerationSettings | undefined)?.mode ?? DEFAULT_SETTINGS.mode;
    },
    set mode(mode: GenerationMode) {
      settings().mode = mode;
    },
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
 * An attempt's picture: a still's own, a take's own or its video's poster; a sound has none.
 *
 * @param from - The generated document's path.
 * @param source - The generated document.
 * @param attempt - One of its attempts.
 * @returns Its picture's address, if it has one.
 */
export function attemptPicture(
  from: string,
  source: GenerativeDocument,
  attempt?: GenerativeDocument['attempts'][number],
): string | undefined {
  if (!attempt || source.type === 'sound') return;
  const { poster } = attempt as { poster?: string };
  const written = source.type === 'still' || PICTURE_FILE.test(attempt.src) ? attempt.src : poster;
  return written && addressAt(from, written);
}

/** A written reference that's an address to load, not a document to follow. */
export const ADDRESS =/^(\/~\/|[a-z][a-z0-9+.-]*:)/i;

/**
 * A picture written in a document as an address to show it from: documents keep them by path from
 * themselves, and only an address reaches `<img>`.
 *
 * @param from - The path of the document it's written in.
 * @param written - The path or address, as written.
 * @returns Its address.
 */
export const addressAt = (from: string, written: string): string =>
  ADDRESS.test(written) ? written : `/${pathFrom(from, written)}`;

/**
 * The picture a written path or address shows: a still's chosen attempt, a take's poster, a
 * persona's face, or the address itself when it's no document.
 *
 * @param from - The path of the document it's written in.
 * @param reference - The path or address, as written.
 * @returns Its picture's address, if it has one.
 */
export function pictureAt(from: string, reference: string): string | undefined {
  if (ADDRESS.test(reference)) return reference;
  const found = follow(from, reference);
  const document = found.document;
  if (!document) return addressAt(from, reference);
  if (isGenerative(document)) return attemptPicture(found.path, document, chosenAttempt(document));
  if (document.type === 'persona') return document.head?.main && pictureAt(found.path, document.head.main);
}
