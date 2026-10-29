import type { DocumentType, GenerationSettings, GenerativeDocument, WedyanDocument } from '@/lib/documents/types.js';

/** The models a generation can be asked of, by what it makes. Placeholders until the kernel names its own. */
export const MODELS: Record<GenerativeDocument['type'], Record<string, string>> = {
  still: { standard: 'Standard', detailed: 'Detailed' },
  take: { standard: 'Standard', cinematic: 'Cinematic' },
  sound: { standard: 'Standard', voice: 'Voice' },
};

/** The aspect ratios a picture can be made at. */
export const ASPECTS = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1' };

/** What a generation is made with when its document doesn't say. */
const DEFAULT_SETTINGS: Required<GenerationSettings> = { model: 'standard', aspect: '16:9', seconds: 4 };

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
 * @returns Its model, aspect ratio and seconds, read from and written to the document.
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
  };
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
