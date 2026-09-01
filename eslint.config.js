import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  { ignores: ['dist', 'node_modules', 'src/data/landmasses.json'] },

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
