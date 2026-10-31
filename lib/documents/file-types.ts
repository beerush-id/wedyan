import { fileModule, writeStub } from '@irpclib/r2-file';

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

// Every write of a document, whoever makes it: the desktop, an agent or the seed, so none can forget.
fileModule.hook(writeStub, (req) => {
  const [path, data, options] = req.args;
  const extension = path.split('.').pop() as string;
  const type = FILE_TYPES[extension];
  if (!type) return;
  req.args[2] = { ...options, type, metadata: { ...options?.metadata, ...(extension === 'motion' ? flagsOf(data) : {}) } };
});

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
