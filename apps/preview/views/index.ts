import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, mediaOf, previewTarget } from '@/lib/systems/public.js';
import { openPreview, preview } from './Main.js';

export { preview };

/** What Preview opens: `preview:/Photos/boats.still`, any document larger, in a window of its own. */
export const linkHandle: Record<string, LinkHandle> = {
  preview: (link) => openPreview(previewTarget(link)),
};

/** A take or a sound: made, and played, rather than edited. */
const PLAYED_FILE = /\.(take|sound)$/;

/**
 * Whether Preview opens a file: a take, a sound, a video or a recording.
 *
 * @param path - The file's path.
 * @returns True for what plays.
 */
export function opens(path: string): boolean {
  const media = mediaOf(path);
  return PLAYED_FILE.test(path) || media === 'video' || media === 'audio';
}

/** Preview's entry: launched on its own, it opens a window saying what it's for. */
export default (({ open }) => {
  open(preview, { name: 'preview' });
}) satisfies AUIBoot;
