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
    // A `..` the URL keeps, since its slash is encoded: the route itself refuses it.
    expect((await fetch('/~/..%2Fsomeone/Pictures/cat.png')).status).toBe(400);
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

describe('any file by its home path', () => {
  /** Bytes a seek can be told from: each one its own position. */
  const CLIP = Uint8Array.from({ length: 256 }, (_, position) => position);
  const base64 = btoa(String.fromCharCode(...CLIP));

  /** A clip in a new folder, as a video file. */
  async function clip(name = 'take.mp4') {
    const path = `~/Motions/${crypto.randomUUID()}/${name}`;
    await write(path, base64, { encoding: 'base64', type: 'video/mp4' });
    return path;
  }

  it('serves a video as it is stored, with no function, from any page', async () => {
    const path = await clip();

    for (const src of [path, `motions/lantern/${path}`]) {
      const response = await fetch(src);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('video/mp4');
      expect(response.headers.get('cache-control')).toBe('private, no-cache');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(CLIP);
    }
  });

  it('answers the range a seek asks for', async () => {
    const response = await fetch(await clip(), { headers: { Range: 'bytes=16-31' } });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 16-31/256');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CLIP.subarray(16, 32));
  });

  it('tells a browser its copy is still good, and when it no longer is', async () => {
    const path = await clip();
    const etag = (await fetch(path)).headers.get('etag') as string;

    const same = await fetch(path, { headers: { 'If-None-Match': etag } });
    expect(same.status).toBe(304);

    await write(path, btoa('another take'), { encoding: 'base64', type: 'video/mp4' });
    const changed = await fetch(path, { headers: { 'If-None-Match': etag } });
    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe('another take');
  });

  it('serves a picture as stored unless it’s asked to change it', async () => {
    const path = `~/Pictures/${crypto.randomUUID()}.png`;
    await write(path, PIXEL, { encoding: 'base64', type: 'image/png' });

    const original = await fetch(path);
    expect(original.headers.get('content-type')).toBe('image/png');
    expect(original.headers.get('cache-control')).toBe('private, no-cache');

    const resized = await fetch(`${path}?s=64&f=webp`);
    expect(resized.headers.get('content-type')).toBe('image/webp');
  });

  it('finds a name with spaces, as a browser encodes it', async () => {
    expect((await fetch(await clip('the first take.mp4'))).status).toBe(200);
  });

  it('serves a file to its own session only, and no other way', async () => {
    const path = await clip();
    expect((await fetch(path, { credentials: 'omit' })).status).toBe(403);

    const [own] = document.cookie.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [];
    const other = document.cookie.replace(own as string, crypto.randomUUID());
    const elsewhere = await fetch(path, { credentials: 'omit', headers: { cookie: other } });
    expect(elsewhere.status).toBe(404);

    // Its storage path isn't an address: delivery opens only behind the session.
    const direct = await fetch(`/users/${own}${path.slice(1)}`);
    expect(direct.headers.get('content-type')).not.toBe('video/mp4');
  });
});
