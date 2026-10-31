import { mutable } from '@airlib/react';
import { resolvePath } from './paths.js';
import type { DocumentOf, DocumentType, WedyanDocument } from './types.js';

export { nameOf, newHeader, parentOf, resolvePath } from './paths.js';

/**
 * Every document on the drive, by its path from the drive's root, e.g. `/Memos/Tone.memo`. The
 * drive observes which documents it holds, not what's in them; each document observes itself.
 */
const DOCUMENTS = mutable({} as Record<string, WedyanDocument>, { recursive: false });

/** What changes as documents are used, for this session: the ones deleted, by path. */
export const drive = mutable({ deleted: [] as string[] });

/**
 * Puts documents on the drive, where every view finds them: whatever serves Wedyan's files hands
 * them over here, before anything reads them. One already at a path is replaced. Each is kept
 * reactive through and through, being one file saved whole, so an edit anywhere in it is seen.
 *
 * @param documents - Each document with its path from the drive's root.
 */
export function supply(documents: Iterable<[path: string, document: WedyanDocument]>): void {
  for (const [path, document] of documents) DOCUMENTS[path] = mutable(document);
}

/**
 * A document by its path from the drive's root.
 *
 * @param path - Its path.
 * @returns The document, unless it isn't there or was deleted.
 */
export function documentAt<T extends DocumentType = DocumentType>(path: string): DocumentOf<T> | undefined {
  if (drive.deleted.includes(path)) return;
  return DOCUMENTS[path] as DocumentOf<T> | undefined;
}

/**
 * Every document of one type still kept, with its path.
 *
 * @param type - The type, e.g. `motion`.
 * @returns Each one and where it is, by path.
 */
export function documentsOf<T extends DocumentType>(type: T): { path: string; document: DocumentOf<T> }[] {
  return Object.entries(DOCUMENTS)
    .map(([path, document]) => ({ path, document }))
    .filter((entry) => entry.document.type === type && !drive.deleted.includes(entry.path))
    .map((entry) => entry as { path: string; document: DocumentOf<T> });
}

/**
 * A free path for a new file in a folder: `<base><extension>`, or the first `<base> N<extension>`
 * not taken.
 *
 * @param folder - The folder it goes in.
 * @param base - Its name before a number.
 * @param extension - Its extension, e.g. `.persona`.
 * @returns The path.
 */
export function freePath(folder: string, base: string, extension: string): string {
  // A deleted file's path stays taken: the drive keeps hiding whatever is put back there.
  const taken = (path: string) => !!documentAt(path) || drive.deleted.includes(path);
  let path = `${folder}/${base}${extension}`;
  for (let n = 2; taken(path); n++) path = `${folder}/${base} ${n}${extension}`;
  return path;
}

/**
 * The document a path written in another document leads to.
 *
 * @param from - The path of the document it is written in.
 * @param path - The path as written.
 * @returns Where it leads, and the document there, if any.
 */
export function follow<T extends DocumentType = DocumentType>(from: string, path: string): { path: string; document: DocumentOf<T> | undefined } {
  const resolved = resolvePath(from, path);
  return { path: resolved, document: documentAt<T>(resolved) };
}
