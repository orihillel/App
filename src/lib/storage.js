// Drop-in replacement for the Claude.ai-artifact-only `window.storage` API the
// mockup was originally written against, backed by real `localStorage` so the
// app works in a normal browser. Same call shape as the original
// (`storage.get(key, encrypted)` -> `{ value }`, `storage.set(key, value, encrypted)`)
// so the call sites ported over unchanged; the `encrypted` argument is accepted
// but unused (localStorage has no such concept).
export const storage = {
  async get(key) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? null : { value };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
  },
};
