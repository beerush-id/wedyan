import { mutable } from '@airlib/react';
import { chosenAttempt } from '@/lib/documents/generation.js';
import { documentsOf, drive, nameOf } from '@/lib/documents/store.js';
import type { StillDocument } from '@/lib/documents/types.js';
import LISTING from '../data/photos.json';

/** Where Photos browses from: the Photos folder at the drive's root. */
export const ROOT = '/Photos';

/** The tag of what's kept as a favorite. */
export const FAVORITE = 'favorite';

/** The tag of what Wedyan made. */
export const GENERATIVE = 'generative';

/** The albums: each a tag that the files in it carry, and its name. */
export const ALBUMS: { tag: string; label: string }[] = LISTING.albums;

/**
 * An image in Photos: its path, which is also its id, its picture, size and date, its tags, and the
 * prompt it was made from when Wedyan made it.
 */
export type Photo = { id: string; path: string; name: string; src: string; size: string; modified: string; tags: string[]; prompt?: string };

/** What a listing is asked for: one folder's contents, or every file carrying a tag, wherever it is. */
export type ListingRequest = { folder: string } | { tag: string };

/** One thing a folder holds: a folder, with how much it holds; a still project; or an image. */
export type Entry =
  | { kind: 'folder'; path: string; name: string; count: number }
  | { kind: 'still'; path: string; name: string; document: StillDocument }
  | { kind: 'photo'; path: string; name: string; photo: Photo };

/** Every image in Photos, in every folder, its tags changing as they're edited. A mock listing, until the drive serves one. */
export const PHOTOS: Photo[] = mutable(LISTING.photos.map((entry) => ({ ...entry, id: entry.path, name: nameOf(entry.path) })));

/** What changes as Photos is used, for this session: the images deleted, by path. */
export const library = mutable({ deleted: [] as string[] });

/**
 * Lists Photos as asked: a folder's contents, or every file carrying a tag. A mock of the drive's
 * listing request, answered from the files at hand.
 *
 * @param request - A folder, or a tag.
 * @returns What the folder holds, or every file with the tag.
 */
export function listing(request: ListingRequest): Entry[] {
  return 'tag' in request ? tagged(request.tag) : folderOf(request.folder);
}

/**
 * Every file carrying a tag, wherever it is: still projects, then images, each in name order.
 *
 * @param tag - The tag.
 * @returns The files.
 */
function tagged(tag: string): Entry[] {
  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name);
  const projects: Entry[] = stills()
    .filter(({ document }) => document.tags?.includes(tag))
    .map(({ path, document }) => ({ kind: 'still', path, name: document.name, document }));
  const photos: Entry[] = kept(PHOTOS)
    .filter((photo) => photo.tags.includes(tag))
    .map((photo) => ({ kind: 'photo', path: photo.path, name: photo.name, photo }));
  return [...projects.sort(byName), ...photos.sort(byName)];
}

/**
 * What a folder holds: its folders, then its still projects, then its images, each in name order.
 * A folder shows how much it holds, all the way down.
 *
 * @param folder - The folder's path, e.g. `/Photos/Trips`.
 * @returns What it holds.
 */
function folderOf(folder: string): Entry[] {
  const photos = kept(PHOTOS);
  const projects = stills();
  const folders = new Map<string, number>();
  const entries: Entry[] = [];

  // Whether a path sits right in the folder; one deeper counts toward the folder it's in.
  const visit = (path: string) => {
    if (!path.startsWith(`${folder}/`)) return false;
    const rest = path.slice(folder.length + 1);
    const slash = rest.indexOf('/');
    if (slash < 0) return true;
    const child = `${folder}/${rest.slice(0, slash)}`;
    folders.set(child, (folders.get(child) ?? 0) + 1);
    return false;
  };

  for (const project of projects) {
    if (visit(project.path)) entries.push({ kind: 'still', path: project.path, name: project.document.name, document: project.document });
  }
  for (const photo of photos) {
    if (visit(photo.path)) entries.push({ kind: 'photo', path: photo.path, name: photo.name, photo });
  }

  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name);
  const subfolders: Entry[] = [...folders].map(([path, count]) => ({ kind: 'folder', path, name: nameOf(path), count }));
  return [
    ...subfolders.sort(byName),
    ...entries.filter((entry) => entry.kind === 'still').sort(byName),
    ...entries.filter((entry) => entry.kind === 'photo').sort(byName),
  ];
}

/**
 * Every still project in Photos, in every folder, leaving out the deleted ones.
 *
 * @returns Each still with its path.
 */
export function stills(): { path: string; document: StillDocument }[] {
  return documentsOf('still').filter(({ path }) => path.startsWith(`${ROOT}/`) && !drive.deleted.includes(path));
}

/**
 * Whether every one of these files carries a tag.
 *
 * @param paths - The files.
 * @param tag - The tag.
 * @returns Whether all of them carry it.
 */
export function allTagged(paths: string[], tag: string): boolean {
  return paths.every((path) => fileAt(path)?.tags?.includes(tag));
}

/**
 * Tags these files, or takes the tag off when every one carries it already.
 *
 * @param paths - The files.
 * @param tag - The tag.
 */
export function toggleTag(paths: string[], tag: string): void {
  const all = allTagged(paths, tag);
  for (const path of paths) {
    const file = fileAt(path);
    if (!file) continue;
    const tags = (file.tags ??= []);
    const at = tags.indexOf(tag);
    if (all && at > -1) tags.splice(at, 1);
    else if (!all && at < 0) tags.push(tag);
  }
}

/**
 * The file at a path that carries tags: an image, or a still project's document.
 *
 * @param path - The file.
 * @returns The image or the still, or none when it's neither in Photos.
 */
function fileAt(path: string): { tags?: string[] } | undefined {
  return PHOTOS.find((photo) => photo.path === path) ?? stills().find((still) => still.path === path)?.document;
}

/**
 * The picture a still shows: its chosen attempt's, or its first's when the choice is gone.
 *
 * @param document - The still.
 * @returns Its picture's address, or none while nothing is made yet.
 */
export function chosenPicture(document: StillDocument): string | undefined {
  return chosenAttempt(document)?.src;
}

/**
 * A free path for a new still in a folder: `Untitled.still`, or the first `Untitled N.still` not taken.
 *
 * @param folder - The folder it goes in.
 * @returns The path.
 */
export function freeStillPath(folder: string): string {
  const taken = new Set(stills().map((still) => still.path));
  let path = `${folder}/Untitled.still`;
  for (let n = 2; taken.has(path); n++) path = `${folder}/Untitled ${n}.still`;
  return path;
}

/**
 * The images not deleted.
 *
 * @param photos - The images to look through.
 * @returns Those still in Photos.
 */
export const kept = (photos: Photo[]): Photo[] => photos.filter((photo) => !library.deleted.includes(photo.id));

/**
 * The images with these ids, in that order, leaving out the deleted ones.
 *
 * @param ids - The images to find.
 * @returns The images found.
 */
export const byId = (ids: string[]): Photo[] =>
  ids.flatMap((id) => kept(PHOTOS).find((photo) => photo.id === id) ?? []);
