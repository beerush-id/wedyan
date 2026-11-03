import { HandlerError, IRPCFile } from '@irpclib/irpc';
import { fileModule, list, readStub, search, writeStub } from '@irpclib/r2-file';
import { isSystemPath } from '../share/system.js';

/**
 * What each kind of document is, by its extension. r2-file types a file by how its data is carried,
 * so without this every document is `application/json`; listing what's a project needs what it is.
 */
export const FILE_TYPES: Record<string, string> = {
  motion: 'application/vnd.wedyan.motion+json',
  stage: 'application/vnd.wedyan.stage+json',
  still: 'application/vnd.wedyan.still+json',
  take: 'application/vnd.wedyan.take+json',
  sound: 'application/vnd.wedyan.sound+json',
  chat: 'application/vnd.wedyan.chat+json',
  memo: 'application/vnd.wedyan.memo+json',
  persona: 'application/vnd.wedyan.persona+json',
  album: 'application/vnd.wedyan.album+json',
  agent: 'application/vnd.wedyan.agent+json',
  receipt: 'application/vnd.wedyan.receipt+json',
};

/** Plain text files, by extension. */
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'json', 'eml', 'ics']);

/** The metadata value of a project's favourite flag and of each of its tags. */
export const FLAGGED = 'true';

// Every write of a document, whoever makes it: the desktop, an agent or the seed, so none can forget.
fileModule.hook(writeStub, async (req) => {
  const [path] = req.args;
  const options = optionsOf(req.args[2]);
  const extension = path.split('.').pop() as string;
  const type = FILE_TYPES[extension];
  // A document made anywhere else arrives as a file: it's read as the words it is, so it's checked,
  // named and listed as one written here is.
  if (type) req.args[1] = (await textOf(req.args[1])) as never;
  const data = req.args[1];
  const encoding = typeof data === 'string' && readsAsText(path) ? { encoding: 'text' as const } : {};
  // What's the system's own stays out of every listing and search.
  const hidden = isSystemPath(path, 'file') ? { hidden: true } : {};
  if (!type) {
    req.args[2] = { ...options, ...encoding, ...hidden };
    return;
  }
  if (typeof data === 'string') assertDocument(path, data);
  req.args[2] = {
    ...options,
    ...encoding,
    ...hidden,
    type,
    metadata: { ...options?.metadata, ...titleOf(data), ...(extension === 'motion' ? flagsOf(data) : {}) },
  };
});

// A document or a text file is words, whoever reads it: unencoded, a read gives a link to download,
// which an agent on the server can't follow.
fileModule.hook(readStub, (req) => {
  const [path] = req.args;
  const options = optionsOf(req.args[1]);
  req.args[1] = options?.encoding === undefined && readsAsText(path) ? { ...options, encoding: 'text' } : options;
});

// A model writes its options as JSON text, and a listing that can't read them lists one folder.
fileModule.hook(list, (req) => {
  req.args[1] = optionsOf(req.args[1]);
});

// A model can write the whole search into its options: what's searched for is still the query.
fileModule.hook(search, (req) => {
  const { query, ...options } = (optionsOf(req.args[1]) ?? {}) as { query?: string };
  req.args[0] = req.args[0] || (query ?? '');
  req.args[1] = options;
});

/**
 * Whether a file is words rather than a picture, a video or a sound.
 *
 * @param path - The file's path.
 * @returns True for a document or a text file.
 */
export function readsAsText(path: string): boolean {
  const extension = path.split('.').pop() as string;
  return extension in FILE_TYPES || TEXT_EXTENSIONS.has(extension);
}

/**
 * A document's content as its text when it came as a file, an upload or a blob; anything else as it is.
 *
 * @param data - What's written.
 * @returns Its text, or it unchanged.
 */
async function textOf(data: unknown): Promise<unknown> {
  const blob = data instanceof IRPCFile ? data.data : data;
  return blob instanceof Blob && blob.size ? blob.text() : data;
}

/**
 * A call's options as an object: a model can write them as JSON text.
 *
 * @param options - The options as they came.
 * @returns The options, or nothing when they can't be read.
 */
export function optionsOf<T extends object>(options: T | string | undefined): T | undefined {
  if (typeof options !== 'string') return options;
  try {
    return JSON.parse(options) as T;
  } catch {
    return undefined;
  }
}

/**
 * Refuses a document written as text that isn't JSON: kept, it could never be opened again. An agent
 * writes documents as text, and the refusal tells it where to correct what it wrote.
 *
 * @param path - The document's path.
 * @param text - The document, as written.
 * @throws HandlerError `EINVAL` naming what's wrong with the text.
 */
function assertDocument(path: string, text: string): void {
  try {
    JSON.parse(text);
  } catch (cause) {
    throw new HandlerError('EINVAL', `${path} is not valid JSON, nothing was written: ${(cause as Error).message}`);
  }
}

/**
 * What a document is called, as file metadata: files are named by id, so this is what a search by
 * name finds.
 *
 * @param data - The document, as an object, or as text as an agent writes it.
 * @returns Its title, when it has a name.
 */
function titleOf(data: unknown): { title?: string } {
  try {
    const { name } = (typeof data === 'string' ? JSON.parse(data) : data) as { name?: unknown };
    return typeof name === 'string' ? { title: name } : {};
  } catch {
    return {};
  }
}

/**
 * A project's flags as file metadata, so a listing can ask for them.
 *
 * @param data - The `.motion`, as an object, or as text as the seed writes it.
 * @returns One key for each tag it carries, and one for being a favourite.
 */
function flagsOf(data: unknown): Record<string, string> {
  try {
    const { favourite, tags } = (typeof data === 'string' ? JSON.parse(data) : data) as { favourite?: boolean; tags?: string[] };
    return Object.fromEntries([...(favourite ? ['favourite'] : []), ...(tags ?? [])].map((flag) => [flag, FLAGGED]));
  } catch {
    return {};
  }
}
