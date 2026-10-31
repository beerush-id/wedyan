/** A file's words as memory finds it by: what it's called, and what it says or was asked to be. */
type Words = (document: never) => unknown[];

/** What's worth finding each kind of document by; its JSON isn't. A memo indexes itself when saved. */
const DOCUMENT_WORDS: Record<string, Words> = {
  motion: (motion: Header) => [...header(motion)],
  stage: (stage: Header) => [...header(stage)],
  still: (still: Generated) => [...header(still), still.prompt, ...attemptPrompts(still)],
  take: (take: Generated) => [...header(take), take.prompt, ...attemptPrompts(take)],
  sound: (sound: Generated) => [...header(sound), sound.prompt, ...attemptPrompts(sound)],
  persona: (persona: Header & { kind?: string }) => [...header(persona), persona.kind],
  agent: (agent: Header & { persona?: string }) => [...header(agent), agent.persona],
  album: (album: Header) => [...header(album)],
  chat: (chat: Header & { messages?: { parts: { kind: string; text?: string }[] }[] }) => [
    ...header(chat),
    ...(chat.messages ?? []).flatMap((message) => message.parts.map((part) => part.text)),
  ],
};

/** Plain text, indexed as it is. */
const TEXT_FILE = /\.(md|txt)$/i;

/** Media, found by its name until something describes it. */
const MEDIA_FILE = /\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav)$/i;

/**
 * Whether memory finds a file by its words.
 *
 * @param path - The file's path.
 * @returns Whether it's text, media, or a kind of document that has words.
 */
export const hasWords = (path: string): boolean => TEXT_FILE.test(path) || MEDIA_FILE.test(path) || extensionOf(path) in DOCUMENT_WORDS;

/**
 * Whether a file's words are its name alone, so its content is never read for them.
 *
 * @param path - The file's path.
 * @returns Whether it's media.
 */
export const isMedia = (path: string): boolean => MEDIA_FILE.test(path);

/**
 * What memory finds a file by.
 *
 * @param path - The file's path.
 * @param content - Its content: text or a document, as an object or as JSON. Media needs none.
 * @returns Its words, unless it has none.
 */
export function wordsOf(path: string, content?: unknown): string | undefined {
  if (MEDIA_FILE.test(path)) return path.slice(path.lastIndexOf('/') + 1).replace(MEDIA_FILE, '');
  if (TEXT_FILE.test(path)) return typeof content === 'string' ? content : undefined;
  const words = DOCUMENT_WORDS[extensionOf(path)];
  const document = parsed(content);
  if (!words || !document) return undefined;
  return (words(document as never).filter(Boolean) as string[]).join('\n\n');
}

type Header = { name?: string; description?: string; author?: { ask?: string } };

type Generated = Header & { prompt?: string; attempts?: { prompt?: string }[] };

function header({ name, description, author }: Header): unknown[] {
  return [name, description, author?.ask];
}

function attemptPrompts({ attempts }: Generated): unknown[] {
  return [...new Set((attempts ?? []).map((attempt) => attempt.prompt))];
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}

function parsed(content: unknown): object | undefined {
  try {
    return (typeof content === 'string' ? JSON.parse(content) : content) as object | undefined;
  } catch {
    return undefined;
  }
}
