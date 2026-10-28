import { mutable } from '@airlib/react';
import type { DocumentOf, DocumentType, WedyanDocument } from './types.js';

/** Every document on the drive, by its path from the drive's root, e.g. `/Motions/Lantern river/Lantern river.motion`. */
const DOCUMENTS = new Map<string, WedyanDocument>();

/** What changes as documents are used, for this session: the ones deleted, by path. */
export const drive = mutable({ deleted: [] as string[] });

/**
 * Puts documents on the drive, where every view finds them: whatever serves Wedyan's files hands
 * them over here, before anything reads them. One already at a path is replaced.
 *
 * @param documents - Each document with its path from the drive's root.
 */
export function supply(documents: Iterable<[path: string, document: WedyanDocument]>): void {
  for (const [path, document] of documents) DOCUMENTS.set(path, document);
}

/**
 * A document by its path from the drive's root.
 *
 * @param path - Its path, e.g. `/Memos/Tone.memo`.
 * @returns The document, unless it isn't there or was deleted.
 */
export function documentAt<T extends DocumentType = DocumentType>(path: string): DocumentOf<T> | undefined {
  if (drive.deleted.includes(path)) return;
  return DOCUMENTS.get(path) as DocumentOf<T> | undefined;
}

/**
 * Every document of one type still kept, with its path.
 *
 * @param type - The type, e.g. `motion`.
 * @returns Each one and where it is, by path.
 */
export function documentsOf<T extends DocumentType>(type: T): { path: string; document: DocumentOf<T> }[] {
  return Array.from(DOCUMENTS, ([path, document]) => ({ path, document }))
    .filter((entry) => entry.document.type === type && !drive.deleted.includes(entry.path))
    .map((entry) => entry as { path: string; document: DocumentOf<T> });
}

/**
 * Where a path written in a document leads: relative paths from the document's folder, absolute
 * ones from the drive's root.
 *
 * @param from - The path of the document it is written in.
 * @param path - The path as written, e.g. `Promo.stage` or `../../Memos/Tone.memo`.
 * @returns The path from the drive's root.
 */
export function resolvePath(from: string, path: string): string {
  if (path.startsWith('/')) return path;
  const parts = from.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/**
 * The document a path written in another document leads to.
 *
 * @param from - The path of the document it is written in.
 * @param path - The path as written.
 * @returns Where it leads, and the document there, if any.
 */
export function follow<T extends DocumentType = DocumentType>(from: string, path: string): { path: string; document?: DocumentOf<T> } {
  const resolved = resolvePath(from, path);
  return { path: resolved, document: documentAt<T>(resolved) };
}
