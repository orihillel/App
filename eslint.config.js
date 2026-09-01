import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  // worker/ is a separate package with its own eslint.config.js, run via its own `npm run
  // lint` — its Workers-runtime globals (Request, Response, fetch, ...) don't belong in this
  // browser-focused config, and linting it here too would just double-report the same files.
  { ignores: ['dist', 'node_modules', 'src/data/landmasses.json', 'worker'] },

  js.configs.recommended,

  // App + component source: browser globals, JSX, React-specific rules.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['**/*.test.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // Just the two long-established hooks rules, not eslint-plugin-react-hooks@7's full
      // "recommended" set — that pulls in a dozen-plus React-Compiler-oriented static-analysis
      // rules (purity, immutability, set-state-in-render, ...) that are a much bigger, stricter
      // adoption than "add basic linting" calls for. These two catch the actual common bugs
      // (a hook called conditionally, a stale closure from a missing effect dependency).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Warns if a file mixes a component export with a non-component export (e.g. a
      // constant), which breaks Vite's Fast Refresh for that file.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // The service worker itself: adds the ServiceWorkerGlobalScope globals (self, clients,
  // caches, registration, ...) the generic browser env above doesn't include.
  {
    files: ['src/sw.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },

  // Test files: same as above plus the vitest/testing-library globals the test setup relies on.
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.vitest },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Node-side build scripts and config files.
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
