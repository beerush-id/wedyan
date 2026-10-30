import { mutable } from '@airlib/react';
import type { DocumentOf, DocumentType, WedyanDocument } from './types.js';

/**
 * Every document on the drive, by its path from the drive's root, e.g. `/Motions/Lantern river/Lantern river.motion`.
 * The drive observes which documents it holds, not what's in them; each document observes itself.
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

/** Every piece of writing on the drive — scripts, notes — as Markdown, by its path from the drive's root. */
const WRITINGS = new Map<string, string>();

/**
 * Puts writing on the drive, as `supply` does documents: Markdown files, as their text. Writing
 * already at a path is replaced, which is how an edit is kept, for this session.
 *
 * @param writings - Each file's text with its path from the drive's root.
 */
export function supplyWriting(writings: Iterable<[path: string, text: string]>): void {
  for (const [path, text] of writings) WRITINGS.set(path, text);
}

/**
 * A piece of writing by its path from the drive's root, or one part of it: a path ending in
 * `#heading` is the section under that heading, by its GitHub-style slug, down to the next heading
 * of the same or a higher level.
 *
 * @param path - Its path, e.g. `/Motions/Lantern river/Script.md` or `…/Script.md#lanterns`.
 * @returns Its Markdown, unless it isn't there or has no such heading.
 */
export function writingAt(path: string): string | undefined {
  const [file, heading] = path.split('#');
  const text = WRITINGS.get(file);
  if (!text || !heading) return text;

  const lines = text.split('\n');
  const section = sectionOf(lines, heading);
  return section && lines.slice(...section).join('\n').trim();
}

/**
 * Keeps an edit of a piece of writing, or of one part of it, for this session: a path ending in
 * `#heading` puts the text in place of that section, or, while the writing has no such heading,
 * after everything in it.
 *
 * @param path - Its path, e.g. `/Motions/Lantern river/Script.md` or `…/Script.md#lanterns`.
 * @param text - Its Markdown as edited.
 */
export function keepWriting(path: string, text: string): void {
  const [file, heading] = path.split('#');
  if (!heading) return void WRITINGS.set(file, text);

  const whole = WRITINGS.get(file) ?? '';
  const lines = whole.split('\n');
  const section = sectionOf(lines, heading);
  if (!section) return void WRITINGS.set(file, whole.trim() ? `${whole.trimEnd()}\n\n${text}` : text);

  const [start, end] = section;
  const after = lines.slice(end);
  WRITINGS.set(file, [...lines.slice(0, start), text, ...(after.length ? ['', ...after] : [])].join('\n'));
}

/**
 * The path of one part of a piece of writing: the section under a heading, by the heading's words.
 *
 * @param file - The writing's path.
 * @param heading - The heading's words, e.g. "Harbor at dawn".
 * @returns E.g. `…/Script.md#harbor-at-dawn`.
 */
export function sectionAt(file: string, heading: string): string {
  return `${file}#${slugOf(heading)}`;
}

/**
 * A document by its path from the drive's root.
 *
 * @param path - Its path, e.g. `/Memos/Tone.memo`.
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
 * The last part of a path: a file's or a folder's name.
 *
 * @param path - The path.
 * @returns Its name.
 */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The folder a path is in.
 *
 * @param path - The path.
 * @returns Its folder's path.
 */
export function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
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

/**
 * Where a section lies among a piece of writing's lines: from its heading down to the next heading
 * of the same or a higher level.
 *
 * @param lines - The writing's lines.
 * @param heading - The section's heading, by its slug.
 * @returns The first line and the line past the last, unless there's no such heading.
 */
function sectionOf(lines: string[], heading: string): [start: number, end: number] | undefined {
  const start = lines.findIndex((line) => /^#+\s/.test(line) && slugOf(line.replace(/^#+\s+/, '')) === heading);
  if (start < 0) return;
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex((line, at) => at > start && (line.match(/^(#+)\s/)?.[1].length ?? Infinity) <= level);
  return [start, end < 0 ? lines.length : end];
}

/**
 * A heading's GitHub-style slug, which a path's `#heading` names it by.
 *
 * @param heading - The heading's words.
 * @returns E.g. `harbor-at-dawn` for "Harbor at dawn".
 */
function slugOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}
