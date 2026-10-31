import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { remember } from '@/lib/assistant/mock.js';
import type { Commands } from '@/lib/systems/public.js';
import { MemosIcon } from './icons.js';
import { memoAt, memos, shortDate } from './library.js';

/** What Memo can do, at `system.memo.name`. */
export const COMMANDS: Commands = {
  remember: { hint: 'Keep a memo', icon: <MemosIcon />, handle: (input) => remember(input) },
  /** Sums up the memo a form picked, by its first line of words. */
  summarize: async ({ form, ack, widgetId }) => {
    const memo = memoAt(form.memo);
    const first = memo?.body.split('\n').find((line) => line.trim() && !line.startsWith('#'));
    if (widgetId) await ack?.(widgetId, { ...form });
    return (
      <p>
        <strong>{memo?.name}</strong> in short: {first ?? 'there is nothing in it yet.'}
      </p>
    );
  },
};

/** What a request can mention while Memo is in front: its memos, each by whose it is and when it changed. */
export const CONTEXTS: DockSuggestion[] = memos().map((memo) => ({
  value: memo.path,
  label: memo.document.name,
  hint: `${memo.document.author.kind === 'agent' ? 'Memory' : 'Personal'} · ${shortDate(memo.document.updated)}`,
  icon: <MemosIcon />,
}));
