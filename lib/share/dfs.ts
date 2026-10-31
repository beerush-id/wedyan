import { exists, list, mkdir, remove, search, write } from '@irpclib/r2-file';
import '@/lib/documents/file-types.js';
import { stillDescribe } from '@/lib/kernel/stills.h.js';
import { createBinding } from './binding.js';
import { generateStill } from './generate.js';
import { imageUrl } from './image.js';
import { openLink } from './links.js';
import { fileRef, watchFolder } from './workspace.js';

/**
 * The desktop's files, in one place: everything a window does with a file, by what it wants to do.
 * Each file is one live object on the desktop, shared by every window showing it and kept in step
 * with every change made to it anywhere in the session.
 *
 * - `read(path, encoding?)`: a file's content, live, for a window that shows or refers to it:
 *   `{ ready, data }`. JSON unless `'text'`.
 * - `list`, `search`, `exists`, `write`, `mkdir`, `remove`: r2-file's own calls, IRPC stubs like any
 *   other, so a window asks for what it shows with `.with(() => args)`, its reader carrying `status`,
 *   `data` and `error`.
 * - `watch(folder, listener)`: every change in a folder, whoever makes it, for a window to act on:
 *   bumping a version its `.with` reads, so a file an agent writes shows up by itself.
 * - `binding(path, options?)`: a document a window works on: its live content, saved as it changes.
 *   With `open` and `update` rules, agents work inside it part by part, and `who(part, id)` says
 *   who's on what. With `blank`, a file that doesn't exist yet is worked on as that, and made by
 *   its first change.
 * - `image(path, resize?)`: a picture's address for `<img src>`, at a size when given.
 * - `link(path)`: a link that opens the file in its app, for a widget or an answer.
 *
 * What only one kind of file does is under that kind:
 *
 * - `still.generate(path, request?)`: new attempts of a still a window works on, saved with its edits.
 * - `still.describe(path, { type })`: its chosen image in words, for one purpose (`face`, `subject`);
 *   kept wherever the app needs them.
 *
 * Paths are home paths (`~/…`).
 */
export const dfs = {
  read: fileRef,
  list,
  search,
  exists,
  write,
  mkdir,
  remove,
  watch: watchFolder,
  binding: createBinding,
  image: imageUrl,
  link: openLink,
  still: { generate: generateStill, describe: stillDescribe },
};
