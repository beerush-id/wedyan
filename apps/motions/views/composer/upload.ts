import { IRPCFile } from '@irpclib/irpc';
import { nameOf, newId, parentOf } from '@/lib/documents/paths.js';
import { dfs } from '@/lib/share/dfs.js';
import type { Project } from '../motion.js';
import { mediaSeconds } from './placement.js';

/** What can be uploaded as an asset. */
export const ASSET_TYPES = 'image/*,video/*,audio/*';

/** A video poster's width; its height follows the video's shape. */
const POSTER_WIDTH = 640;

/** The moment of a video its poster shows, in seconds, past any fade in. */
const POSTER_AT = 0.5;

/**
 * Puts an uploaded file in a project: stored under an id, with its own name as its title, which can
 * be changed later without moving it, and held by the project as an asset.
 *
 * @param project - The project.
 * @param file - The file.
 * @returns When it's stored and held.
 */
export async function addAsset(project: Project, file: File): Promise<void> {
  const folder = parentOf(project.path);
  const id = newId();
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const path = `${folder}/${id}.${extension}`;
  const url = URL.createObjectURL(file);
  const metadata: Record<string, string> = { title: file.name.replace(/\.[^.]+$/, '') };

  try {
    if (file.type.startsWith('audio/')) metadata.duration = String(await mediaSeconds(url, 'audio'));
    if (file.type.startsWith('video/')) {
      metadata.duration = String(await mediaSeconds(url, 'video'));
      metadata.thumbnail = await storePoster(url, `${folder}/${id}.poster.webp`);
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  await dfs.write(path, new IRPCFile({ name: nameOf(path), size: file.size, type: file.type }, file), { metadata });
  project.document.assets = [...project.document.assets, nameOf(path)];
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
