import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, mediaOf, previewTarget, requestLink } from '@/lib/systems/public.js';
import { openPreview, preview } from './Main.js';

export { preview };

/**
 * What Preview opens: `preview:/Photos/boats.still`, anything it shows, larger, in a window of its
 * own. A file it doesn't show, like a `.motion`, goes to the app that opens its kind.
 */
export const linkHandle: Record<string, LinkHandle> = {
  preview: (link) => {
    const target = previewTarget(link);
    if (typeof target === 'string' && !SHOWN_FILE.test(target)) return requestLink(target);
    openPreview(target);
  },
};

/** The documents Preview shows, beside pictures, videos and sounds by their address. */
const SHOWN_FILE = /\.(still|persona|take|sound)$/;

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
