import { withContext } from '@airlib/react';
import { issueSession } from '@/lib/share/cookie.js';

// What a browser does that jsdom doesn't: a page's fetch and WebSocket resolve relative URLs against
// the page, and its fetch sends the page's cookies to its own origin (jsdom's WebSocket does that).

const PageSocket = globalThis.WebSocket;

globalThis.WebSocket = class extends PageSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const resolved = new URL(url, location.href);
    resolved.protocol = resolved.protocol === 'https:' ? 'wss:' : resolved.protocol.replace(/^http:$/, 'ws:');
    super(resolved, protocols);
  }
};

const nodeFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const request = new Request(input instanceof Request ? input : new URL(String(input), location.href), init);
  if (new URL(request.url).origin !== location.origin || request.credentials === 'omit') return nodeFetch(request);

  const headers = new Headers(request.headers);
  headers.set('cookie', document.cookie);
  return nodeFetch(new Request(request, { headers, duplex: 'half' } as RequestInit));
};

// Each test file is a visitor: given a session as the first page load gives one.
withContext(issueSession);
