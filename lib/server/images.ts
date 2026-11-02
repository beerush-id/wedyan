import type { AIAdapter, ImageAspectRatio, ImageOptions, ImageOutput } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { mutable } from '@irpclib/irpc/core';
import { read } from '@irpclib/r2-file';
import { fsContext } from '@irpclib/r2-file/context';
import { url } from '@irpclib/r2-image';
import { createWorker as createImageWorker, type ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { chosenAttempt } from '@/lib/documents/generation.js';
import type { StillDocument } from '@/lib/documents/types.js';
import { recall } from '@/lib/memory/memory.h.js';
import type { SavedOptions } from '@/lib/share/ai.js';
import { IMAGE_SIZES } from '@/lib/share/image.js';
import { pathFrom } from '@/lib/share/paths.js';

/** The model Wedyan generates images with: Muse Image, a flat price per image whatever its size. */
export const IMAGE_MODEL = 'muse-image-1.0';

/** Where resized pictures are kept in the bucket: outside every home, so they're never a user's files. */
const VARIANTS_PREFIX = '.variants';

/** What's a picture to a search: a still, or an image file. */
const PICTURE_FILE = /\.(still|webp|png|jpe?g|gif|avif)$/i;

/** How many files a photo search looks through: others on the drive are close too, and are left out. */
const SEARCHED_FILES = 20;

/** How many pictures a photo search returns. */
const FOUND_PHOTOS = 8;

/** The part of a D1 binding finding a still's picture uses. */
type PictureIndex = {
  prepare(query: string): { bind(path: string): { first<T>(): Promise<T | null> } };
};

/** A still's document, which is never a picture itself. */
const STILL_EXTENSION = '.still';

/** The origin R2 Image is asked on from within the server; only the path and the size matter to it. */
const PICTURES_ORIGIN = 'http://localhost';

/**
 * R2 Image on the server: the user's pictures resized on request and kept once per size, in the same
 * bucket as their files. It knows no sessions: reach it only with a picture already scoped to one.
 */
export const pictures = createImageWorker({ variantPrefix: VARIANTS_PREFIX, allowedSizes: IMAGE_SIZES });

/**
 * Whether a path names a picture inside the home and only there: R2 Image reads the bucket as it is,
 * so a path that climbs out would reach another user's files.
 *
 * @param path - The picture's path, as asked.
 * @returns Whether it's a home path (`~/…`) that never climbs out.
 */
export function isHomePath(path: string): boolean {
  return path.startsWith('~/') && !path.includes('\0') && !path.split('/').includes('..');
}

/**
 * Where a picture in a user's home is kept in the bucket, as R2 Image finds it.
 *
 * @param homeDir - The user's home directory in storage.
 * @param path - The picture's home path (`~/…`).
 * @returns The picture's storage path.
 */
export function picturePath(homeDir: string, path: string): string {
  return `${homeDir}${path.slice(1)}`;
}

/**
 * The picture a path stands for when asked for as one: a still's own path is what's listed, so a
 * widget showing a still names it, and what it means is the attempt the still has chosen.
 *
 * @param db - The drive's index.
 * @param homeDir - The user's home directory in storage.
 * @param path - The home path asked for (`~/…`).
 * @returns The picture's home path; the path itself when it isn't a still, undefined for a still with
 *   nothing made yet.
 */
export async function pictureAt(db: PictureIndex, homeDir: string, path: string): Promise<string | undefined> {
  if (!path.endsWith(STILL_EXTENSION)) return path;
  const row = await db
    .prepare('SELECT thumbnail FROM _r2_files WHERE path = ?')
    .bind(picturePath(homeDir, path))
    .first<{ thumbnail: string | null }>();
  return row?.thumbnail ? pathFrom(path, row.thumbnail.replace(/^\//, '')) : undefined;
}

/**
 * A picture of the calling user's home, resized as WebP by R2 Image, inline: for a model to look at,
 * smaller than the original and kept once per size like the desktop's.
 *
 * @param env - The bucket and the resizer.
 * @param path - The picture's home path (`~/…`).
 * @param size - Its longest edge, one of `IMAGE_SIZES`.
 * @returns The resized picture as a data URL; throws when there's no home or it can't be resized.
 */
export async function resizePicture(env: ImageWorkerEnv, path: string, size: number): Promise<string> {
  if (!isHomePath(path)) throw new Error(`${path} isn't a picture in the home`);
  const homeDir = fsContext.get()?.homeDir;
  if (!homeDir) throw new Error(`No home to find ${path} in`);
  const target = new URL(url('/', { size, format: 'webp' }), PICTURES_ORIGIN);
  target.pathname = picturePath(homeDir, path);
  const response = await pictures.fetch(new Request(target), env);
  if (!response.ok) throw new Error(`${path} couldn't be resized (${response.status})`);
  const type = response.headers.get('content-type') ?? 'image/webp';
  return `data:${type};base64,${base64Of(new Uint8Array(await response.arrayBuffer()))}`;
}

/**
 * Serves `sys.photos.search` for the agents: the user's pictures by what they show, from what the
 * drive's index holds of each, which for a still is what it was asked to be.
 *
 * @param args - The `query`: what the photo shows.
 * @returns The closest pictures first, each with what's known of it and how close it is.
 */
export async function searchPhotos(args: IRPCData): Promise<IRPCData> {
  const { query } = (args ?? {}) as { query?: string };
  if (!query?.trim()) return { error: 'sys.photos.search needs a query: what the photo shows' };
  const found = await recall({ query, scope: 'files', limit: SEARCHED_FILES });
  const pictures = found.filter(({ path }) => PICTURE_FILE.test(path));
  const shown = await Promise.all(pictures.map(({ path }) => hasPicture(path)));
  const photos = pictures
    .filter((_, at) => shown[at])
    .slice(0, FOUND_PHOTOS)
    .map(({ path, name, text, score }) => ({ path, name, about: text, score }));
  return { photos };
}

/**
 * Whether a file has a picture to show: a still has none until something's been made.
 *
 * @param path - The file's path in the home.
 * @returns Whether it does.
 */
async function hasPicture(path: string): Promise<boolean> {
  if (!path.endsWith(STILL_EXTENSION)) return true;
  const still = await read<StillDocument>(path, { encoding: 'json' }).catch(() => undefined);
  return !!still && !!chosenAttempt(still);
}

/** What an agent asks `sys.image.generate` for. */
type GenerateArgs = { prompt?: string; saveTo?: string; aspect?: ImageAspectRatio };

/**
 * Serves `sys.image.generate` for the agents: one image from a description, kept in the user's
 * drive in the folder they name (the drive driver names it by its id), never as a link that expires.
 *
 * @param adapter - The server's models, the drive driver last.
 * @returns The handler: the new image's path in the drive, or why there is none.
 */
export function generateImage(adapter: AIAdapter): (args: IRPCData) => Promise<IRPCData> {
  return async (args) => {
    const { prompt, saveTo, aspect } = (args ?? {}) as GenerateArgs;
    if (!prompt || !saveTo?.startsWith('~/')) {
      return { error: 'sys.image.generate needs a prompt, and saveTo: a folder in the home (~/…)' };
    }
    const output = await drawImage(adapter, {
      prompt,
      model: IMAGE_MODEL,
      saveTo,
      ...(aspect ? { aspectRatio: aspect } : {}),
    });
    return output?.url ? { path: output.url } : { error: 'No image came back' };
  };
}

/**
 * Draws one image on the server's models, kept in the drive when the options say where.
 *
 * @param adapter - The server's models, the drive driver last.
 * @param options - What to draw, and where to keep it.
 * @returns What was drawn: its id, and its path in the drive once kept.
 */
export async function drawImage(
  adapter: AIAdapter,
  options: ImageOptions & SavedOptions,
): Promise<ImageOutput | undefined> {
  const state = mutable<{ data?: ImageOutput }>({});
  await new Promise<void>((resolve, reject) => {
    void adapter.draw(options, { state, resolve, reject });
  });
  return state.data;
}

/** Bytes as Base64, a slice at a time so a large picture never overflows the call stack. */
function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
