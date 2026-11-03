import { airPages } from '@airlib/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { homeSeed } from './vite.seed.js';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    homeSeed(),
    react(),
    airPages({
      markdown: { extended: true },
      searchIndex: true,
    }),
  ],
});
