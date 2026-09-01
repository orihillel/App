import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules', '.wrangler'] },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Cloudflare Workers' global scope is modeled on ServiceWorkerGlobalScope (fetch,
      // Request/Response, caches, crypto, console, ...) — `globals.node` is added too since
      // the test suite runs under plain Node (see vitest.config.js), which provides the same
      // Fetch API globals natively (Node 18+) alongside its own (process, etc.).
      globals: { ...globals.serviceworker, ...globals.node },
    },
  },
];
