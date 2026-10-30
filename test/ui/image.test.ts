import { list, write } from '@irpclib/r2-file';
import { describe, expect, it } from 'vitest';
import { imageUrl } from '../../lib/share/image.js';

// A picture as the desktop shows one: an `<img src>` by its home path, resized by R2 Image on the
// running server, and only ever the asking session's own.

/** A 1×1 PNG: real enough to decode and resize. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('pictures on the desktop', () => {
  it('serves a picture resized, by its home path, kept only by the asking browser', async () => {
    const folder = `~/Pictures/${crypto.randomUUID()}`;
    const path = `${folder}/cat photo #1.png`;
    await write(path, PIXEL, { encoding: 'base64', type: 'image/png' });

    const response = await fetch(imageUrl(path, { size: 64, format: 'webp' }));
    expect(response.status).toBe(200);
    // Resized: the original is a PNG.
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toMatch(/^private/);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);

    // The resized copy is kept outside the user's files.
    const listed = await list(folder);
    expect(listed.entries.map((entry) => entry.name)).toEqual(['cat photo #1.png']);
  });

  it('resizes a picture once, then serves the size it kept', async () => {
    const path = `~/Pictures/${crypto.randomUUID()}.png`;
    await write(path, PIXEL, { encoding: 'base64', type: 'image/png' });

    const resized = await fetch(imageUrl(path, { size: 128, format: 'webp' }));
    expect(resized.status).toBe(200);
    // Freshly resized: no stored copy, so no ETag yet.
    expect(resized.headers.get('etag')).toBeNull();

    // The same size by another URL, so no cached response answers it: served from the kept copy.
    const kept = await fetch(`${imageUrl(path)}?f=webp&s=128`);
    expect(kept.status).toBe(200);
    expect(kept.headers.get('content-type')).toBe('image/webp');
    expect(kept.headers.get('etag')).not.toBeNull();
  });

  it('serves the original for a size it does not keep', async () => {
    const path = `~/Pictures/${crypto.randomUUID()}.png`;
    await write(path, PIXEL, { encoding: 'base64', type: 'image/png' });

    const response = await fetch(imageUrl(path, { size: 100, format: 'webp' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it('serves nothing without a session, and nothing outside the home', async () => {
    const path = `~/Pictures/${crypto.randomUUID()}.png`;
    await write(path, PIXEL, { encoding: 'base64', type: 'image/png' });

    expect((await fetch(imageUrl(path, { size: 64 }), { credentials: 'omit' })).status).toBe(403);
    expect((await fetch(imageUrl('/users/someone/Pictures/cat.png'))).status).toBe(400);
    // A `..` the URL keeps, since its slash is encoded: the route itself refuses it.
    expect((await fetch('/images/~/..%2Fsomeone/Pictures/cat.png')).status).toBe(400);
  });

  it('serves a picture to its own session only', async () => {
    const path = `~/Pictures/${crypto.randomUUID()}.png`;
    await write(path, PIXEL, { encoding: 'base64', type: 'image/png' });
    expect((await fetch(imageUrl(path))).status).toBe(200);

    // Another visitor: the same cookie with another session's id, asking for the same path.
    const [own] = document.cookie.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [];
    const other = document.cookie.replace(own as string, crypto.randomUUID());
    const response = await fetch(imageUrl(path), { credentials: 'omit', headers: { cookie: other } });
    expect(response.status).toBe(404);
  });
});
