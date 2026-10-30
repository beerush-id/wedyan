import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { MemosIcon } from './icons.js';
import { KINDS, memos, shortDate } from './library.js';

/** What Memo adds to the prompt's commands while it's in front. */
export const COMMANDS: DockSuggestion[] = [{ value: 'remember', label: 'remember', hint: 'Keep a memo', icon: <MemosIcon /> }];

/** What a request can mention while Memo is in front: its memos, each by its kind and when it changed. */
export const CONTEXTS: DockSuggestion[] = memos().map((memo) => ({
  value: memo.path,
  label: memo.document.name,
  hint: `${KINDS[memo.document.kind]} · ${shortDate(memo.document.updated)}`,
  icon: <MemosIcon />,
}));
