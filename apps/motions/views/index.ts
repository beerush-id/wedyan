import type { AUIBoot } from '@airlib/react-aui/desktop';
import { nameOf, parentOf } from '@/lib/documents/paths.js';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { motionComposer, openMotion } from './composer/index.js';
import { motionLibrary, openLibrary } from './library/index.js';
import { MOTION_FILE } from './motion.js';

export { COMMANDS as commands } from './prompt.js';
export { motionComposer, motionLibrary };

/** A stage's file, which opens the project it's in. */
const STAGE_FILE = /\.stage$/;

/** What Motions opens: `motions:~/Motions/Teaser/Teaser.motion`, in Direct; a stage opens its project. */
export const linkHandle: Record<string, LinkHandle> = {
  motions: (link) => void openMotion(projectOf(linkTarget(link)), true),
};

/**
 * Whether Motions opens a file: a project, or one of its stages.
 *
 * @param path - The file's path.
 * @returns True for a `.motion` or a `.stage`.
 */
export function opens(path: string): boolean {
  return MOTION_FILE.test(path) || STAGE_FILE.test(path);
}

/**
 * The project a file opens: a stage's is the `.motion` its folder is named for, as a project is one
 * folder named by its id.
 *
 * @param path - A project's or a stage's path.
 * @returns The project's path.
 */
function projectOf(path: string): string {
  if (!STAGE_FILE.test(path)) return path;
  const folder = parentOf(path);
  return `${folder}/${nameOf(folder)}.motion`;
}

/** Motions' entry: launching it opens the library. */
export default (() => {
  openLibrary();
}) satisfies AUIBoot;
