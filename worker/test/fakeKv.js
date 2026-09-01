// A minimal in-memory stand-in for a Workers KV namespace binding — just the subset of the
// real KV interface src/store.js actually calls (get/put/delete/list with cursor paging).
// Good enough to test this repo's own logic against; it can't verify Cloudflare's real KV
// semantics (eventual consistency, real size/rate limits) — nothing short of a live
// deployment can, and this repo can't create one on its own (see worker/README.md).
export function createFakeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ cursor } = {}) {
      // No real pagination needed for tests — one page, everything, cursor param accepted
      // and ignored so store.js's paging loop still works (it always sees list_complete).
      void cursor;
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: undefined };
    },
    _store: store, // test-only escape hatch to inspect state directly
  };
}
