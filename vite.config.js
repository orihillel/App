// vitest/config re-exports Vite's defineConfig with the `test` field merged
// in, so the same config file works for both `vite build`/`vite dev` and
// `vitest` — no separate vitest.config.js needed.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest (a hand-written src/sw.js, precache list injected at build time)
      // instead of the default generateSW (a fully auto-generated worker) -- needed for the
      // custom `push`/`notificationclick` listeners generateSW has no hook for.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['icons/favicon-32.png'],
      manifest: {
        name: 'Tideline — Surf Forecast',
        short_name: 'Tideline',
        description: 'Live surf forecast, an interactive spot globe, and wind/tide-aware alerts.',
        theme_color: '#070F18',
        background_color: '#070F18',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Precache list + runtime caching for Google Fonts / the forecast APIs now live in
      // src/sw.js itself (injectManifest mode has no top-level `workbox.runtimeCaching`
      // option the way generateSW does).
    }),
  ],
  // Served from https://<owner>.github.io/App/ by the GitHub Pages deploy
  // workflow, so asset URLs need the repo name as a base path.
  base: '/App/',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // worker/ is a separate package (its own node_modules, its own vitest.config.js, run via
    // `npm test` inside worker/) — without the extra 'worker/**' entry here, Vitest's default
    // test-file glob picks up worker/test/*.test.js too, which then fails in CI: the root
    // `npm ci` never installs worker's dependencies, and these tests want the node
    // environment, not jsdom. The rest of this list is Vitest's own default exclude set,
    // repeated here (rather than left implicit) since setting `exclude` at all replaces it.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'worker/**',
    ],
  },
});
