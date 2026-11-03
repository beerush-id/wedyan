import { toast } from '@airlib/react-aui';
import { IRPC_STATUS } from '@irpclib/irpc';
import { homeIndexing } from '@/lib/kernel/home.h.js';

/**
 * Shows memory reading a new home's files, in a toast that stays until it has read them all: until
 * then, search and the agent's recall don't find everything yet. A home read already shows nothing.
 */
export function showIndexing(): void {
  const indexing = homeIndexing();
  let shown: ReturnType<typeof toast.info> | undefined;
  let finished = false;

  const stop = indexing.subscribe(() => {
    if (finished) return;
    if (indexing.status !== IRPC_STATUS.PENDING) {
      finished = true;
      shown?.dismiss();
      // Told at once, it finished before there was anything to stop.
      queueMicrotask(() => stop());
      return;
    }
    if (shown || indexing.data.done >= indexing.data.total) return;
    shown = toast.info(() => `Getting your files ready for search: ${indexing.data.done} of ${indexing.data.total}`, {
      duration: 0,
    });
  });
}
