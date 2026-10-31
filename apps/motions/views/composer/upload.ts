import { snapshot } from '@airlib/react';
import { IRPCFile } from '@irpclib/irpc';
import { nameOf, newId, parentOf } from '@/lib/documents/paths.js';
import type { FileRow, RowKind } from '@/lib/documents/rows.js';
import { LOUNGE, LOUNGE_EVENT } from '@/lib/kernel/workspace.h.js';
import { dfs } from '@/lib/share/dfs.js';
import type { Project } from '../motion.js';
import type { Composer } from './context.js';
import { mediaSeconds } from './placement.js';

/** What can be uploaded as an asset. */
export const ASSET_TYPES = 'image/*,video/*,audio/*';

/** The kinds of file those are. */
const ASSET_KINDS = new Set(['image', 'video', 'audio']);

/** A video poster's width; its height follows the video's shape. */
const POSTER_WIDTH = 640;

/** The moment of a video its poster shows, in seconds, past any fade in. */
const POSTER_AT = 0.5;

/**
 * Puts files in the window's project, one after another, leaving out what can't be an asset.
 *
 * @param composer - The project's window.
 * @param files - The files, picked or dropped.
 * @returns When they're stored and held.
 */
export async function addAssets(composer: Composer, files: FileList): Promise<void> {
  const { project } = composer;
  if (!project) return;
  for (const file of Array.from(files)) {
    if (ASSET_KINDS.has(file.type.slice(0, file.type.indexOf('/')))) await addAsset(composer, project, file);
  }
}

/**
 * Puts an uploaded file in a project: stored under an id, with its own name as its title, which can
 * be changed later without moving it, and held by the project as an asset. It's in the window's list
 * from the start, shown from the browser's copy until it's stored.
 *
 * @param composer - The project's window.
 * @param project - The project.
 * @param file - The file.
 * @returns When it's stored and held.
 */
async function addAsset(composer: Composer, project: Project, file: File): Promise<void> {
  const folder = parentOf(project.path);
  const id = newId();
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const path = `${folder}/${id}.${extension}`;
  const kind = file.type.slice(0, file.type.indexOf('/')) as RowKind;
  const url = URL.createObjectURL(file);
  const title = file.name.replace(/\.[^.]+$/, '');
  const metadata: Record<string, string> = { title };
  const row = composer.add({
    path,
    name: title,
    size: file.size,
    type: file.type,
    mtime: new Date(),
    isDirectory: false,
    public: false,
    hidden: false,
    metadata,
    kind,
    src: url,
    thumbnail: kind === 'image' ? url : undefined,
    duration: 0,
    position: project.document.assets.length,
    held: true,
  } as FileRow);

  try {
    if (kind === 'audio' || kind === 'video') {
      row.duration = await mediaSeconds(url, kind);
      metadata.duration = String(row.duration);
    }
    if (kind === 'video') metadata.thumbnail = await storePoster(url, `${folder}/${id}.poster.webp`);
    await dfs.write(path, new IRPCFile({ name: nameOf(path), size: file.size, type: file.type }, file), { metadata });
  } catch (error) {
    composer.drop(row);
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }

  row.src = `/~${path.slice(1)}`;
  row.thumbnail = metadata.thumbnail ?? (kind === 'image' ? row.src : undefined);
  project.document.assets = [...project.document.assets, nameOf(path)];
  LOUNGE.ask({ type: LOUNGE_EVENT.CREATED, data: snapshot(row) });
}

/**
 * Stores a video's poster, so its row has a picture without loading the video.
 *
 * @param url - The video's address.
 * @param path - Where the poster goes.
 * @returns Where it's delivered from.
 */
async function storePoster(url: string, path: string): Promise<string> {
  const video = document.createElement('video');
  video.muted = true;
  video.src = url;
  await new Promise((seeked, failed) => {
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(POSTER_AT, video.duration / 2);
    };
    video.onseeked = seeked;
    video.onerror = failed;
  });

  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = Math.round((POSTER_WIDTH * video.videoHeight) / video.videoWidth);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const poster = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 0.8));
  if (!poster) throw new Error('The poster could not be made');

  // A part of the video, not an asset of its own, so it lists as nothing.
  const file = new IRPCFile({ name: nameOf(path), size: poster.size, type: poster.type }, poster);
  await dfs.write(path, file, { metadata: { part: 'true' } });
  return `/~${path.slice(1)}`;
}
