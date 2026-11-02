import { subscribe } from '@irpclib/irpc/core';
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
 * A document on the drive once it has arrived, for what can't act until it knows: a file nothing has
 * opened yet has no content the moment it's first asked for.
 *
 * @param path - Its home path (`~/…`).
 * @returns The document, if it's there.
 */
export function documentArrived<T extends DocumentType = DocumentType>(path: string): Promise<DocumentOf<T> | undefined> {
  const file = fileRef<DocumentOf<T>>(path);
  if (file.ready) return Promise.resolve(file.data ?? undefined);
  return new Promise((resolve) => {
    const stop = subscribe(file, () => {
      if (!file.ready) return;
      queueMicrotask(() => stop());
      resolve(file.data ?? undefined);
    });
  });
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
