import { exists, list, mkdir, read, remove, search, update, write } from '@irpclib/r2-file';
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
 * - `update(path, { metadata })`: what's known about a file or folder, without touching its content:
 *   a rename moves nothing.
 * - `load(path)`: a document once, for a change made without opening it.
 * - `watch(folder, listener)`: what's written in a folder outside what the session holds, like an
 *   agent's work, for a window to learn of what it doesn't have.
 * - `binding(path, options?)`: a document a window works on: its live content, each change sent as
 *   it's made to the room that holds it.
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
  update,
  load: <T>(path: string) => read<T>(path, { encoding: 'json' }),
  watch: watchFolder,
  binding: createBinding,
  image: imageUrl,
  link: openLink,
  still: { generate: generateStill, describe: stillDescribe },
};
