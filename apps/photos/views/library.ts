import { mutable } from '@airlib/react';
import FILES from '@/apps/files/data/files.json';
import GENERATED from '../data/generated.json';
import LIBRARY from '../data/library.json';

/** A photo in the library: a picture from storage, or one Wedyan made, with the prompt it was made from. */
export type Photo = { id: string; name: string; src: string; size: string; modified: string; prompt?: string };

/** The library: every picture in storage, then every picture Wedyan made. */
export const PHOTOS: Photo[] = [
  ...(FILES as Array<Photo & { kind: string }>).filter((file) => file.kind === 'image' && file.src),
  ...GENERATED,
];

/** What changes as the library is used, for this session: the favorites, and the photos deleted. */
export const library = mutable({ favorites: [...LIBRARY.favorites], deleted: [] as string[] });

/**
 * The photos not deleted.
 *
 * @param photos - The photos to look through.
 * @returns Those still in the library.
 */
export const kept = (photos: Photo[]): Photo[] => photos.filter((photo) => !library.deleted.includes(photo.id));

/**
 * The photos with these ids, in that order, leaving out the deleted ones.
 *
 * @param ids - The photos to find.
 * @returns The photos found.
 */
export const byId = (ids: string[]): Photo[] =>
  ids.flatMap((id) => kept(PHOTOS).find((photo) => photo.id === id) ?? []);
