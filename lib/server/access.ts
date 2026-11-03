/** Where an access link carries its key: `?access_key=…`. */
export const ACCESS_PARAM = 'access_key';

/** The cookie a browser keeps once its link let it in: what the key hashes to, never the key. */
const ACCESS_COOKIE = 'wedyan_access';

/** How long a browser stays let in, in seconds. */
const ACCESS_AGE = 60 * 60 * 24 * 30;

/**
 * Who may use this deployment, when it's private. Without a key, everyone. With one, a browser comes
 * in through a link carrying it: the key is swapped for a cookie and the link sent on without it, so
 * the key never stays in the address bar, history or a referrer. Every request after carries the
 * cookie: the page, the calls that spend on models, the socket they run over.
 *
 * @param request - The request.
 * @param key - The deployment's key; none when it's open.
 * @returns Nothing when it may go on; otherwise what answers it: the way in, or a refusal.
 */
export async function admit(request: Request, key: string | undefined): Promise<Response | undefined> {
  if (!key) return;
  const url = new URL(request.url);
  const given = url.searchParams.get(ACCESS_PARAM);
  const pass = await digest(key);

  if (given !== null) {
    if ((await digest(given)) !== pass) return refused();
    url.searchParams.delete(ACCESS_PARAM);
    const cookie = `${ACCESS_COOKIE}=${pass}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_AGE}`;
    return new Response(null, { status: 302, headers: { Location: `${url.pathname}${url.search}`, 'Set-Cookie': cookie } });
  }
  return cookieOf(request, ACCESS_COOKIE) === pass ? undefined : refused();
}

/** What a request without the way in is told. */
function refused(): Response {
  return new Response('This Wedyan is private. Open it with the link you were given.', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** A key's SHA-256, as hex: what a cookie can hold without holding the key. */
async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** One cookie's value on a request. */
function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
}
