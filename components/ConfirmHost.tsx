import { $bind, For, mutable, setup } from '@airlib/react';
import { Confirm } from '@airlib/react-aui';

/** What a confirmation asks. */
export type ConfirmOptions = {
  /** The question's heading, e.g. "Delete Motion". */
  title: string;
  /** What answering yes means, in a line. */
  message: string;
  /** The answer that does it, e.g. "Delete". */
  action?: string;
  /** The action's color: `error` for what can't be taken back. */
  color?: 'primary' | 'error';
};

/** A confirmation on screen, and who's waiting for its answer. */
type ConfirmEntry = ConfirmOptions & { open: boolean; answer: (confirmed: boolean) => void };

/** Every confirmation waiting for an answer, oldest first. */
const confirms = mutable<ConfirmEntry[]>([]);

/**
 * Asks the user to confirm something, from anywhere: a command, a store, a window. What's asked
 * shows in the desktop's `ConfirmHost`, and stays until it's answered.
 *
 * @param options - The question, what answering yes means, and the answer that does it.
 * @returns Whether the user confirmed.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((answer) => {
    confirms.push({ ...options, open: true, answer });
  });
}

/** Takes an answered confirmation off the list, once it's closed. */
function dismiss(entry: ConfirmEntry): void {
  const at = confirms.indexOf(entry);
  if (at > -1) confirms.splice(at, 1);
}

/** The desktop's confirmations: one modal for each waiting in `confirmDialog`'s list. */
export const ConfirmHost = setup(
  () => () => (
    <For each={() => confirms}>
      {(entry) => (
        <Confirm
          title={entry.title}
          description={entry.message}
          actionLabel={entry.action ?? 'Confirm'}
          cancelLabel="Cancel"
          color={entry.color}
          open={$bind(entry, 'open')}
          onconfirm={() => entry.answer(true)}
          oncancel={() => entry.answer(false)}
          onclose={() => dismiss(entry)}
        />
      )}
    </For>
  ),
  'ConfirmHost'
);
