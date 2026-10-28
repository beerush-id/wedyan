import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests never start the page scaffolder.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    // Test files that run r2-file on local D1 share it; one file at a time, as r2-file's own tests do.
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
  },
});
