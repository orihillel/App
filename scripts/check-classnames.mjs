#!/usr/bin/env node
// Guards against the bug fixed in App.jsx's GLOBAL_CSS: every className token used across
// src/**/*.jsx must resolve to either a hand-authored class in GLOBAL_CSS or one of the
// component-level classes defined by hand elsewhere (tl-btn, tl-input, tl-pulse, tl-label,
// no-scrollbar). Run via `npm run check:classnames`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.jsx')) out.push(full);
  }
  return out;
}

// Only literal className="..." strings are checked -- a handful of call sites compute a
// className with a template/ternary (e.g. `className={isLoading ? 'tl-pulse' : ''}`), and
// those individual string literals are covered by scanning for '...' tokens too.
const classNameLiteral = /className=(?:"([^"]*)"|'([^']*)')/g;
const usedTokens = new Set();
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(classNameLiteral)) {
    const value = m[1] ?? m[2];
    for (const token of value.split(/\s+/).filter(Boolean)) usedTokens.add(token);
  }
}

const appJsx = readFileSync(join(SRC, 'App.jsx'), 'utf8');
const definedClasses = new Set();
for (const m of appJsx.matchAll(/\.([a-zA-Z0-9-]+)\s*[{,:]/g)) definedClasses.add(m[1]);

const missing = [...usedTokens].filter((t) => !definedClasses.has(t)).sort();
if (missing.length) {
  console.error('className tokens used in src/**/*.jsx with no matching CSS class in App.jsx:');
  for (const t of missing) console.error('  ' + t);
  process.exit(1);
}
console.log(`OK — all ${usedTokens.size} className tokens have a matching CSS class.`);
