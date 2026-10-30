import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { ORIGIN } from './test/ui/server.js';

// Kept apart from vite.config.ts so tests never start the page scaffolder.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    // Test files that run r2-file on local D1 share it; one file at a time, as r2-file's own tests do.
    fileParallelism: false,
    projects: [
      {
        // The server's logic, in process.
        extends: true,
        test: { name: 'backend', include: ['test/**/*.test.ts'], exclude: ['test/ui/**'] },
      },
      {
        // The page's code against the built server: a page at the server's origin, every call over the wire.
        extends: true,
        test: {
          name: 'ui',
          include: ['test/ui/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: ORIGIN } },
          globalSetup: ['test/ui/server.ts'],
          setupFiles: ['test/ui/browser.ts'],
        },
      },
    ],
  },
});
