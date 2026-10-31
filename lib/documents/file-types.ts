import { fileModule, writeStub } from '@irpclib/r2-file';
import { posterOf, runtime } from './stage.js';
import type { StageDocument } from './types.js';

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
};

/** The metadata value of a project's favourite flag and of each of its tags. */
export const FLAGGED = 'true';

/** What a listing or a search needs of each kind of document, as file metadata, so neither reads the file. */
const LISTED: Record<string, (document: never) => Record<string, string>> = { motion: flagsOf, stage: stageFacts };

// Every write of a document, whoever makes it: the desktop, an agent or the seed, so none can forget.
fileModule.hook(writeStub, (req) => {
  const [path, data, options] = req.args;
  const extension = path.split('.').pop() as string;
  const type = FILE_TYPES[extension];
  if (!type) return;
  req.args[2] = { ...options, type, metadata: { ...options?.metadata, ...listedOf(extension, data) } };
});

/**
 * What a document gives its listing.
 *
 * @param extension - Its kind.
 * @param data - The document, as an object, or as text as the seed writes it.
 * @returns Its metadata, empty for a kind no listing asks about, or a document that doesn't parse.
 */
function listedOf(extension: string, data: unknown): Record<string, string> {
  try {
    return LISTED[extension]?.((typeof data === 'string' ? JSON.parse(data) : data) as never) ?? {};
  } catch {
    return {};
  }
}

/**
 * A project's flags, so a listing can ask for them.
 *
 * @param motion - The `.motion`.
 * @returns One key for each tag it carries, and one for being a favourite.
 */
function flagsOf({ favourite, tags }: { favourite?: boolean; tags?: string[] }): Record<string, string> {
  return Object.fromEntries([...(favourite ? ['favourite'] : []), ...(tags ?? [])].map((flag) => [flag, FLAGGED]));
}

/**
 * What a stage's row shows, and which project it's listed under.
 *
 * @param stage - The `.stage`.
 * @returns Its id, its project, its place there, its name, its duration in seconds, and its thumbnail if it has one.
 */
function stageFacts(stage: StageDocument): Record<string, string> {
  const thumbnail = posterOf(stage);
  return {
    id: stage.id,
    projectId: stage.projectId,
    order: String(stage.order),
    title: stage.name,
    duration: String(runtime(stage.composition)),
    ...(thumbnail ? { thumbnail } : {}),
  };
}
