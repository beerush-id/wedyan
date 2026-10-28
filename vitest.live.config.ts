import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Opt-in checks against real model APIs; they spend credits, so `test` never runs them.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    include: ['test/live/**/*.live.ts'],
    env: loadEnv('', process.cwd(), ''),
    testTimeout: 120_000,
  },
});
