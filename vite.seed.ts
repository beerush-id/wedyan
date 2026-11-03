import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/** What every new home starts with, beside this file: `seeds/home/X` lands at `~/X`. */
const SEED_DIR = join(import.meta.dirname, 'seeds/home');

/** Where the seed's pictures and media are served from, among the client build's files. */
const MEDIA_URL = '/seeds/home';

/** The seed's pictures and media, by extension, with the type each is written as; every other file is text. */
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** The module the server reads the seed from. */
const SEED_MODULE = 'virtual:home-seed';
const RESOLVED_SEED_MODULE = `\0${SEED_MODULE}`;

/**
 * The home seed, kept out of the worker's code: its text is bundled as it is, while its pictures and
 * media, far larger, ship among the client build's files, which don't count toward the worker's size,
 * and are read from there as a home is seeded. In development they're read from the seed's folder.
 *
 * `virtual:home-seed` exports `TEXT`, the text seeds by path; `MEDIA`, each picture or media's type by
 * path; `MEDIA_URL`, where they're served; and, in development only, `readMedia`, which reads one.
 *
 * @returns The plugin.
 */
export function homeSeed(): Plugin {
  let building = false;
  let ssr = false;

  return {
    name: 'wedyan-home-seed',
    configResolved(config) {
      building = config.command === 'build';
      ssr = Boolean(config.build.ssr);
    },
    resolveId(id) {
      return id === SEED_MODULE ? RESOLVED_SEED_MODULE : undefined;
    },
    load(id) {
      if (id !== RESOLVED_SEED_MODULE) return;
      const text: Record<string, string> = {};
      const media: Record<string, string> = {};
      for (const { file, path, type } of seedFiles()) {
        this.addWatchFile(file);
        if (type) media[path] = type;
        else text[path] = readFileSync(file, 'utf8');
      }
      return [
        `export const TEXT = ${JSON.stringify(text)};`,
        `export const MEDIA = ${JSON.stringify(media)};`,
        `export const MEDIA_URL = ${JSON.stringify(MEDIA_URL)};`,
        building
          ? 'export const readMedia = undefined;'
          : `export const readMedia = async (path) => new Uint8Array(await (await import('node:fs/promises')).readFile(${JSON.stringify(SEED_DIR)} + '/' + path));`,
      ].join('\n');
    },
    generateBundle() {
      if (ssr) return;
      for (const { file, path, type } of seedFiles()) {
        if (type) this.emitFile({ type: 'asset', fileName: `${MEDIA_URL.slice(1)}/${path}`, source: readFileSync(file) });
      }
    },
  };
}

/** Every seed file: where it is, its path in the home, and its type when it's a picture or media. */
function seedFiles(): { file: string; path: string; type?: string }[] {
  return readdirSync(SEED_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => {
      const file = join(entry.parentPath, entry.name);
      const path = relative(SEED_DIR, file).split(sep).join('/');
      return { file, path, type: MEDIA_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] };
    });
}
