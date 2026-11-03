import { stream } from '@irpclib/irpc';
import { fsContext } from '@irpclib/r2-file/context';
import { type HomeIndexing, homeIndexing, homeReady } from '@/lib/kernel/home.h.js';
import { kernel } from '@/lib/kernel/package.js';
import { followIndexing } from './seed.js';

// Every call seeds its session's home before it runs, so by the time this answers, the home is ready.
kernel.construct(homeReady, async () => {});

kernel.construct(homeIndexing, () =>
  stream<HomeIndexing>((state, resolve) => {
    const session = fsContext.get()?.ownerId;
    const stop = session
      ? followIndexing(session, (indexing, finished) => {
          state.data = indexing;
          if (finished) resolve();
        })
      : undefined;
    if (!stop) return void resolve();
    return stop;
  }, { total: 0, done: 0 })
);
