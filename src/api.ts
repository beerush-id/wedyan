import { HTTPTransport } from '@irpclib/http';
import { createPackage } from '@irpclib/irpc';
import { WebSocketTransport } from '@irpclib/ws';

/** Where every call arrives, whatever carries it: anything under it is a Wedyan RPC call. */
export const WRPC = '/wrpc-';

/** Where r2-file's calls arrive. */
export const FILES_ENDPOINT = `${WRPC}files`;

/** Where ai-kit's calls arrive. */
export const AI_ENDPOINT = `${WRPC}ai`;

export const irpc = createPackage({
  name: 'irpc',
  version: '1.0.0',
});

export const httpTransport = new HTTPTransport({
  endpoint: `${WRPC}http/${irpc.href}`,
});

export const wsTransport = new WebSocketTransport({
  url: `${WRPC}ws/${irpc.href}`,
});

// Switch to `wsTransport` to experience near-0 latency.
irpc.use(httpTransport);
