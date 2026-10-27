import { createPackage } from '@irpclib/irpc';
import { wsTransport } from '@/src/api.js';

/**
 * The kernel's own IRPC package. Asks run over WebSocket: one socket per session keeps every
 * packet of a call on the session's Durable Object. File operations stay on the app package's HTTP.
 */
export const kernel = createPackage({
  name: 'wedyan-kernel',
  version: '1.0.0',
});

kernel.use(wsTransport);
