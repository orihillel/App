import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COLORS } from './colors.js';

// Every `COLORS.something` in the app has to name a token that exists.
//
// Written after `COLORS.seafoam` — a token this palette has never had — went in unnoticed. It
// throws nothing: the style becomes `border: '1px solid undefined'`, which browsers drop, and
// `color: undefined`, which inherits. The button simply loses its active state, and it looks
// like a design choice rather than a bug. The sibling of scripts/check-classnames.mjs, for the
// same reason: mistakes that degrade silently need a test, because nothing else will report them.
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('COLORS references', () => {
  it('every COLORS.<token> used in the app is a token the palette defines', () => {
    const known = new Set(Object.keys(COLORS));
    const missing = [];
    for (const file of sourceFiles('src')) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bCOLORS\.([A-Za-z0-9_]+)/g)) {
        if (!known.has(m[1])) missing.push(file + ' -> COLORS.' + m[1]);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every token is a usable CSS colour, not an empty string', () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(typeof value, name).toBe('string');
      expect(value.length, name).toBeGreaterThan(2);
      expect(/^(#|rgb|hsl)/.test(value), name + ' = ' + value).toBe(true);
    }
  });
});
