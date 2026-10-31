import type { FileDriver } from '@irpclib/r2-file/adapter';
import { fsContext } from '@irpclib/r2-file/context';
import type { FileInfo } from '@irpclib/r2-file';
import { FILE_TYPES } from '@/lib/documents/file-types.js';
import type { StageRow } from '@/lib/documents/stage.js';

/**
 * An r2-file driver that turns what's listed into what a list shows: a document's facts flat on its
 * entry, written as metadata by the write hook, and its home path, so no window works out where a
 * file is or reads it to draw a row. Anything else lists as it is.
 *
 * @returns The driver, to `use` after the storage drivers.
 */
export function listRows(): FileDriver {
  return {
    async list(ctx) {
      if (!ctx.result) return;
      const home = fsContext.get()?.homeDir ?? '';
      ctx.result.entries = ctx.result.entries.map((entry) => (entry.type === FILE_TYPES.stage ? (stageRow(entry, home) as never) : entry));
    },
  };
}

/**
 * A listed stage as a row.
 *
 * @param file - The listed file.
 * @param home - Where the user's home is in storage.
 * @returns The row.
 */
function stageRow(file: FileInfo, home: string): StageRow {
  const { id, projectId, title, order, duration, thumbnail } = file.metadata as Record<string, string>;
  return { id, projectId, name: title, path: `~${file.path.slice(home.length)}`, order: Number(order), duration: Number(duration), thumbnail };
}
