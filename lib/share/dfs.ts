import { stillDescribe } from '@/lib/kernel/stills.h.js';
import { createBinding } from './binding.js';
import { generateStill } from './generate.js';
import { imageUrl } from './image.js';
import { openLink } from './links.js';
import { fileRef } from './workspace.js';

/**
 * The desktop's files, in one place: everything a window does with a file, by what it wants to do.
 * Each file is one live object on the desktop, shared by every window showing it and kept in step
 * with every change made to it anywhere in the session.
 *
 * - `read(path, encoding?)`: a file's content, live, for a window that shows or refers to it:
 *   `{ ready, data }`. JSON unless `'text'`.
 * - `binding(path, rules?)`: a document a window works on: its live content, saved as it changes.
 *   With rules, agents work inside it part by part, and `who(part, id)` says who's on what.
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
  binding: createBinding,
  image: imageUrl,
  link: openLink,
  still: { generate: generateStill, describe: stillDescribe },
};
