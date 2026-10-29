import type { ComposeOptions } from '@irpclib/ai-kit';
import type { AIDriver, AudioContext, ImageContext, VideoContext } from '@irpclib/ai-kit/worker';
import { remove, write } from '@irpclib/r2-file';
import type { SavedOptions } from '@/lib/share/ai.js';

/** The file extension of each kind of media a generator returns inline. */
const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/**
 * Keeps generated media in the user's drive. Added last to the adapter, after the providers: when
 * a call asks to `saveTo` a folder, whatever a provider made is written into it, named by the
 * output's id, and the output's `url` becomes that file's path. r2-file streams the content
 * straight from the provider's link, so nothing generated is left pointing outside the drive,
 * where a link may expire. Calls without `saveTo` are left as the provider served them. The file
 * is removed if the call fails after it was kept.
 */
export class DriveDriver implements AIDriver {
  readonly name = 'drive';

  /** Keeps a drawn image. */
  async draw(ctx: ImageContext): Promise<void> {
    await keep(ctx);
  }

  /** Keeps a filmed video. */
  async film(ctx: VideoContext): Promise<void> {
    await keep(ctx);
  }

  /** Keeps composed audio: music, sound effects, ambience. */
  async compose(ctx: AudioContext<ComposeOptions>): Promise<void> {
    await keep(ctx);
  }
}

/** What every generation context shares that keeping needs. */
type Generated = Pick<ImageContext, 'rollbacks'> & {
  payload: unknown;
  state: { data: { id: string; url?: string } };
};

/**
 * Writes a provider's output into the call's `saveTo` folder, and points the output at it.
 *
 * @param ctx - The generation's context, served by a provider before this driver.
 */
async function keep(ctx: Generated): Promise<void> {
  const folder = (ctx.payload as SavedOptions).saveTo?.replace(/\/+$/, '');
  const output = ctx.state.data;
  // Nothing to keep, or already a file in the drive.
  if (!folder || !output.url || !/^(https|data):/.test(output.url)) return;

  const path = `${folder}/${output.id}.${extensionOf(output.url)}`;
  await write(path, output.url, { encoding: 'url' });
  ctx.rollbacks.add(async () => {
    await remove(path);
  });
  output.url = path;
}

/**
 * The extension a generated file is named with, known without downloading it: a data URL's media
 * type, or the extension in a hosted link's path; `bin` when neither says.
 *
 * @param url - The provider's link to the result.
 * @returns The extension, without its dot.
 */
function extensionOf(url: string): string {
  if (url.startsWith('data:')) return EXTENSIONS[/^data:([^;,]+)/.exec(url)?.[1] ?? ''] ?? 'bin';
  return /\.([a-z0-9]{2,4})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? 'bin';
}
