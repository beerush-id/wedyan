import { read, write } from '@irpclib/r2-file';
import { beforeAll, describe, expect, it } from 'vitest';
import { documentPresence } from '../../lib/kernel/document.h.js';
import { createBinding } from '../../lib/share/binding.js';
import {
  clipRules,
  desktopAnswers,
  KAI,
  LUMI,
  PROJECT,
  type Project,
  projectPath,
  until,
} from '../fixtures/documents.js';
import { asUser, setupDocuments } from './documents.js';

beforeAll(setupDocuments);

describe('working inside a document', () => {
  it('opens a part only by the app’s rules, writes it whole through the app, and shows who is on it', async () => {
    const path = projectPath();
    const as = asUser();

    await as(async () => {
      await write(path, PROJECT);

      const doc = createBinding<Project>(
        path,
        clipRules(() => doc.data),
      );
      const ask = desktopAnswers();
      await until(() => doc.ready);

      expect(ask('doc.open', { path, part: 'clip', id: 'v4' }, KAI)).toEqual({ refused: `Assigned to ${LUMI}` });
      expect(ask('doc.open', { path, part: 'stage', id: 's1' }, KAI)).toEqual({ refused: 'Only clips can be opened' });
      expect(ask('doc.update', { path, part: 'clip', id: 'v3', value: { title: 'Nope' } }, KAI)).toEqual({
        refused: 'Open that part first',
      });

      expect(ask('doc.open', { path, part: 'clip', id: 'v3' }, KAI)).toEqual({
        opened: { id: 'v3', title: 'Hero', assignee: KAI },
      });
      await until(() => doc.who('clip', 'v3').includes(KAI));

      const value = { id: 'v3', title: 'Episode 1', assignee: KAI };
      expect(ask('doc.update', { path, part: 'clip', id: 'v3', value }, KAI)).toEqual({ updated: true });
      expect(doc.data?.clips[0].title).toBe('Episode 1');
      // Another agent can't write a part it didn't open, even one it names.
      expect(ask('doc.update', { path, part: 'clip', id: 'v3', value }, LUMI)).toEqual({
        refused: 'Open that part first',
      });

      // Saved like any edit in the window.
      let kept: Project | undefined;
      await until(() => {
        void read(path, { encoding: 'json' }).then((saved) => {
          kept = saved as Project;
        });
        return kept?.clips[0].title === 'Episode 1';
      });

      expect(ask('doc.close', { path }, KAI)).toEqual({ closed: true });
      await until(() => doc.who('clip', 'v3').length === 0);

      // Bound again: the agents' asks reach the window that bound it last, with its rules.
      const again = createBinding<Project>(path, { open: () => 'Closed for this test', update: () => true });
      await until(() => again.ready);
      expect(again.data).toEqual(JSON.parse(JSON.stringify(doc.data)));
      expect(ask('doc.open', { path, part: 'clip', id: 'v3' }, KAI)).toEqual({ refused: 'Closed for this test' });
    });
  });

  it('refuses a document that isn’t open on the desktop', async () => {
    const ask = desktopAnswers();

    expect(ask('doc.open', { path: '~/Nowhere.motion', part: 'clip', id: 'v1' }, KAI)).toEqual({
      refused: 'That document is not open on the desktop',
    });
  });
});

describe('presence in a document', () => {
  it('shows every desktop of the session who is on which part, one part per actor, gone with its desktop', async () => {
    const path = `~/Motions/${crypto.randomUUID()}.motion`;
    const as = asUser();

    await as(async () => {
      const first = documentPresence(path);
      const second = documentPresence(path);
      await until(() => first.data.ready && second.data.ready);

      await first.ask('open', 'clip', 'v3', KAI);
      await until(() => second.data.parts['clip:v3']?.includes(KAI) === true);

      // Opening another part moves the actor there.
      await first.ask('open', 'clip', 'v4', KAI);
      await until(() => second.data.parts['clip:v4']?.includes(KAI) === true);
      expect(second.data.parts['clip:v3']).toBeUndefined();

      // A desktop that leaves takes what was opened on it.
      first.close();
      await until(() => second.data.parts['clip:v4'] === undefined);
      second.close();
    });
  });
});
