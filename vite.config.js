import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://<owner>.github.io/App/ by the GitHub Pages deploy
  // workflow, so asset URLs need the repo name as a base path.
  base: '/App/',
});
