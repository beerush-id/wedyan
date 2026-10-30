import { withContext } from '@airlib/react';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { wedyan } from '../../lib/share/wedyan.js';

// The desktop opening its conversation: one call, its tab's ID kept for it.

describe('a desktop opening the conversation', () => {
  it('opens as this tab, keeping its ID, and a duplicated tab opens with one of its own', async () => {
    await withContext(async () => {
      const first = wedyan();
      await waitFor(() => expect(first.data.ready).toBe(true));
      const id = sessionStorage.getItem('wedyan.tab');
      expect(id).toBeTruthy();

      // A duplicated tab: the same storage, so the same ID, while the first is still open.
      const second = wedyan();
      await waitFor(() => expect(second.data.ready).toBe(true), { timeout: 4000 });
      expect(sessionStorage.getItem('wedyan.tab')).not.toBe(id);

      first.close();
      second.close();
    });
  });
});
