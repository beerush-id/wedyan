import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { shortDate } from '@/lib/documents/rows.js';
import { save } from '@/lib/memory/memory.h.js';
import { linkTo } from '@/lib/systems/links.js';
import type { Commands } from '@/lib/systems/public.js';
import type { PromptEvent } from '@/lib/systems/registry.js';
import { shown } from './context.js';
import { MemosIcon } from './icons.js';
import { groupOf } from './library.js';

/** What Memo can do, at `system.memo.name`. */
export const COMMANDS: Commands = {
  remember: { hint: 'Keep a memo', icon: <MemosIcon />, handle: ({ event }) => remember(event as PromptEvent) },
};

/**
 * What a request can mention while Memo is in front: the memos its window lists, each by whose it
 * is and when it changed.
 *
 * @returns One suggestion each, by its path in the home.
 */
export function contexts(): DockSuggestion[] {
  const { memos } = shown;
  if (!memos) return [];
  return [...memos.rows('personal'), ...memos.rows('memory')].map((row) => ({
    value: row.path,
    label: row.name,
    hint: `${groupOf(row) === 'memory' ? 'Memory' : 'Personal'}${row.updated ? ` · ${shortDate(row.updated)}` : ''}`,
    icon: <MemosIcon />,
  }));
}

/**
 * Keeps what the prompt says as a memory, and says where it is.
 *
 * @param prompt - The sent prompt.
 * @returns What came of it.
 */
async function remember({ text, selections }: PromptEvent) {
  const words = selections.reduce((rest, { label }) => rest.replace(`/${label}`, ''), text).trim();
  if (!words) return 'Say what to keep after /remember.';
  try {
    const { path, name } = await save({ text: words });
    return (
      <p>
        <strong>{name}</strong> is kept. <a href={linkTo('memo', path)}>Open it</a>.
      </p>
    );
  } catch (error) {
    return `Couldn't keep it: ${(error as Error).message}`;
  }
}
