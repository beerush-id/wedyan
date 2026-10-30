import { $static, setup } from '@airlib/react';
import { fileModule, read, readStub, write } from '@irpclib/r2-file';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StillDocument } from '../../lib/documents/types.js';
import { documentPresence } from '../../lib/kernel/document.h.js';
import { createBinding } from '../../lib/share/binding.js';
import { fileRef } from '../../lib/share/workspace.js';
import { clipRules, desktopAnswers, KAI, PROJECT, type Project, projectPath } from '../fixtures/documents.js';

// A window as an app writes one: it binds its document in setup and draws who works on a clip. Its
// file and its presence come from the running server.

afterEach(cleanup);

/** A clip as a Motion window shows it: its title, and who is working on it. */
const ClipView = setup((props: { path: string; id: string }) => {
  // A window's document never changes while it's open.
  const doc = createBinding<Project>(
    $static(() => props.path),
    clipRules(() => doc.data),
  );

  return () => {
    if (!doc.ready) return <p>Loading</p>;
    const title = doc.data?.clips.find((clip) => clip.id === props.id)?.title;
    return <p>{`${title}: ${doc.who('clip', props.id).join(', ') || 'nobody'}`}</p>;
  };
}, 'ClipView');

describe('a window binding its document', () => {
  it('shows who works on a clip as it changes, and lets go of everything when it closes', async () => {
    const path = projectPath();
    await write(path, PROJECT);
    // Another desktop showing the same document.
    const other = documentPresence(path);
    const ask = desktopAnswers();

    const view = render(<ClipView path={path} id="v3" />);
    await waitFor(() => expect(view.container.textContent).toBe('Hero: nobody'));

    act(() => {
      expect(ask('doc.open', { path, part: 'clip', id: 'v3' }, KAI)).toMatchObject({ opened: { id: 'v3' } });
    });
    await waitFor(() => expect(view.container.textContent).toBe(`Hero: ${KAI}`));
    await waitFor(() => expect(other.data.parts['clip:v3']).toEqual([KAI]));

    act(() => {
      const value = { id: 'v3', title: 'Episode 1', assignee: KAI };
      expect(ask('doc.update', { path, part: 'clip', id: 'v3', value }, KAI)).toEqual({ updated: true });
    });
    await waitFor(() => expect(view.container.textContent).toBe(`Episode 1: ${KAI}`));
    // Saved like any edit in the window.
    await waitFor(async () => {
      fileModule.invalidate(readStub, path, { encoding: 'json' });
      expect((await read<Project>(path, { encoding: 'json' }))?.clips[0].title).toBe('Episode 1');
    });

    // The window closes: the agents' asks no longer reach it, and what it granted is let go of. Its
    // cleanup runs a moment after the unmount, not during it.
    view.unmount();
    await waitFor(() =>
      expect(ask('doc.open', { path, part: 'clip', id: 'v3' }, KAI)).toEqual({
        refused: 'That document is not open on the desktop',
      }),
    );
    await waitFor(() => expect(other.data.parts['clip:v3']).toBeUndefined());
    other.close();
  });

  it('shares one live object between a window working on a file and a document referring to it', async () => {
    const path = projectPath();
    await write(path, PROJECT);
    const view = render(<ClipView path={path} id="v3" />);
    await waitFor(() => expect(view.container.textContent).toBe('Hero: nobody'));

    // Referred to elsewhere: the same object the window works on, nothing opened for it.
    const reference = fileRef<Project>(path);
    const hero = reference.data?.clips[0];
    expect(hero?.title).toBe('Hero');

    // Changed outside the window, as an agent or another tab would.
    await write(path, { clips: [{ ...PROJECT.clips[0], title: 'Episode 2' }, PROJECT.clips[1]] });
    await waitFor(() => expect(view.container.textContent).toBe('Episode 2: nobody'));
    // Changed in place: whoever held it holds the change.
    expect(hero?.title).toBe('Episode 2');
    expect(reference.data?.clips[0]).toBe(hero);
  });

  it('takes an agent’s new attempts into a still the window is editing, and saves them with it', async () => {
    const path = `~/People/${crypto.randomUUID()}/Head.still`;
    const still = {
      type: 'still',
      version: 1,
      id: 'h1',
      name: 'Head',
      created: '2026-10-30T00:00:00.000Z',
      updated: '2026-10-30T00:00:00.000Z',
      author: { kind: 'user' },
      prompt: 'Ayla, face',
      references: [],
      attempts: [],
      edits: [],
      chosen: '',
    };
    await write(path, still);
    const ask = desktopAnswers();
    const attempt = {
      id: 'a1',
      src: 'Head/a1.webp',
      prompt: 'Ayla, face',
      settings: {},
      created: still.created,
      url: '/x',
    };

    // Not open here: the server keeps them itself.
    expect(ask('doc.attempts', { path, request: { prompt: 'Ayla, face' }, attempts: [attempt] }, KAI)).toEqual({
      added: false,
    });

    const StillView = setup((props: { path: string }) => {
      const doc = createBinding<StillDocument>(
        $static(() => props.path),
        { open: () => 'No parts', update: () => 'No parts' },
      );
      return () => (
        <p>{doc.ready ? `${doc.data?.attempts.length} attempts, chosen ${doc.data?.chosen || 'none'}` : 'Loading'}</p>
      );
    }, 'StillView');
    const view = render(<StillView path={path} />);
    await waitFor(() => expect(view.container.textContent).toBe('0 attempts, chosen none'));

    act(() => {
      expect(ask('doc.attempts', { path, request: { prompt: 'Ayla, smiling' }, attempts: [attempt] }, KAI)).toEqual({
        added: true,
      });
    });
    await waitFor(() => expect(view.container.textContent).toBe('1 attempts, chosen a1'));
    await waitFor(async () => {
      fileModule.invalidate(readStub, path, { encoding: 'json' });
      const saved = await read<StillDocument>(path, { encoding: 'json' });
      expect(saved).toMatchObject({
        prompt: 'Ayla, smiling',
        chosen: 'a1',
        attempts: [{ id: 'a1', src: 'Head/a1.webp' }],
      });
      expect(saved?.attempts[0]).not.toHaveProperty('url');
    });
  });

  it('shows a document opened again at once, from its kept content', async () => {
    const path = projectPath();
    await write(path, PROJECT);
    const first = render(<ClipView path={path} id="v4" />);
    await waitFor(() => expect(first.container.textContent).toBe('Closing: nobody'));
    first.unmount();

    const again = render(<ClipView path={path} id="v4" />);
    expect(fileRef<Project>(path).ready).toBe(true);
    // Its content is there at once; the window waits only for its presence.
    await waitFor(() => expect(again.container.textContent).toBe('Closing: nobody'));
  });
});
