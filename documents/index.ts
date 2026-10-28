import { supply, supplyWriting } from '@/lib/documents/store.js';
import type { WedyanDocument } from '@/lib/documents/types.js';

/** The sample documents beside this file, read as text, by their path from this folder. */
const FILES = import.meta.glob('./**/*.{motion,stage,still,take,chat,memo,persona,album}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The sample writing beside this file — scripts, notes — as Markdown. */
const WRITINGS = import.meta.glob('./**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// This folder stands in for the drive until the backend serves one: its files go on the drive at
// their paths from here, e.g. `./Memos/Tone.memo` as `/Memos/Tone.memo`.
supply(Object.entries(FILES).map(([file, text]) => [file.slice(1), JSON.parse(text) as WedyanDocument]));
supplyWriting(Object.entries(WRITINGS).map(([file, text]) => [file.slice(1), text]));
