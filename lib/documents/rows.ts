import type { FileInfo } from '@irpclib/r2-file';

/** What a row is: a kind of document, a kind of media, or a folder. */
export type RowKind = 'folder' | 'motion' | 'stage' | 'still' | 'take' | 'sound' | 'persona' | 'agent' | 'image' | 'video' | 'audio';

/**
 * A file as every list shows it, whatever it is, from one listing: no list reads a file to draw a row.
 * `path` is a home path, `name` what it's called rather than its file name.
 */
export type FileRow = Omit<FileInfo, 'path' | 'name'> & {
  path: string;
  name: string;
  kind: RowKind;
  id?: string;
  description?: string;
  thumbnail?: string;
  /** Where its media is played or shown from. */
  src?: string;
  /** How long it runs, in seconds: a stage, or a project's stages together. */
  duration: number;
  /** Its place among what it belongs to. */
  position: number;
  /** Whether the project listed holds it, as an asset or a cast. */
  held?: boolean;
  status?: string;
  /** Who made it, in a word. */
  author?: string;
  /** What it was asked to be. */
  ask?: string;
  updated?: string;
};

/** What each kind of asset is called. */
export const ASSET_KINDS: Partial<Record<RowKind, string>> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  still: 'Generated image',
  take: 'Generated video',
  sound: 'Generated sound',
};

/**
 * What a listing holds: the rows themselves, so whoever reads one sees what's changed on it.
 *
 * @param listing - A list reader.
 * @returns Its rows; none until they've arrived.
 */
export const rowsOf = (listing: { data?: { entries?: unknown[] } }): FileRow[] =>
  (listing.data?.entries ?? []) as FileRow[];
