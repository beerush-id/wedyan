import { list } from '@irpclib/r2-file';
import { describe, expect, it } from 'vitest';

// A new visitor, over the wire: their home is seeded before their first call is answered.

describe('a new home', () => {
  it('has the seed by the time the desktop first looks', async () => {
    const agents = await list('~/Agents');
    expect(agents.entries.map((entry) => entry.name).sort()).toEqual([
      'Animation.agent',
      'Audio.agent',
      'Editor.agent',
      'Image.agent',
      'Story.agent',
      'Video.agent',
    ]);
  });
});
