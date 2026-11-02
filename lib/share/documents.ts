import { readsAsText } from '@/lib/documents/file-types.js';
import { resolvePath } from '@/lib/documents/paths.js';
import type { DocumentOf, DocumentType } from '@/lib/documents/types.js';
import { fileRef } from './workspace.js';

/**
 * A document on the drive, the same live object wherever it's read.
 *
 * @param path - Its home path (`~/…`).
 * @returns The document, once it has arrived and if it's there.
 */
export function documentAt<T extends DocumentType = DocumentType>(path?: string): DocumentOf<T> | undefined {
  return path ? (fileRef<DocumentOf<T>>(path).data ?? undefined) : undefined;
}

/**
 * The document a path written in another document leads to.
 *
 * @param from - The path of the document it's written in.
 * @param path - The path as written.
 * @returns Where it leads, and the document there, once it has arrived; none for a picture, a video
 *   or a sound, which is never a document to read.
 */
export function follow<T extends DocumentType = DocumentType>(
  from: string,
  path: string,
): { path: string; document: DocumentOf<T> | undefined } {
  const resolved = resolvePath(from, path);
  return { path: resolved, document: readsAsText(resolved) ? documentAt<T>(resolved) : undefined };
}
