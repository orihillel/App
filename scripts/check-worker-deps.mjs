// Every app file the Worker bundles must be watched by the Worker's deploy workflow.
//
// worker/src imports a handful of modules from src/lib, and wrangler bundles them at deploy
// time. The workflow triggers on paths, so a shared file missing from that list ships to the
// browser and not to the Worker: the two then run different copies of the same module, which
// does not fail anywhere, it just quietly disagrees -- a stale spot catalog serving conditions
// for spots the app no longer has, or an alert rule the two sides evaluate differently.
//
// Run with: npm run check:worker-deps
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const workerSrc = fileURLToPath(new URL('worker/src/', root));
const workflow = readFileSync(fileURLToPath(new URL('.github/workflows/deploy-worker.yml', root)), 'utf8');

const imported = new Set();
for (const file of readdirSync(workerSrc)) {
  if (!file.endsWith('.js')) continue;
  const body = readFileSync(workerSrc + file, 'utf8');
  for (const m of body.matchAll(/from\s+'(\.\.\/\.\.\/src\/[^']+)'/g)) {
    imported.add(m[1].replace('../../', ''));
  }
}

const missing = [...imported].filter((p) => !workflow.includes("'" + p + "'"));
if (missing.length) {
  console.error('These files are bundled into the Worker but are not in deploy-worker.yml\'s paths:\n');
  for (const p of missing) console.error('  ' + p);
  console.error('\nWithout them, changing one deploys the app and not the Worker.');
  process.exit(1);
}
console.log('OK — all ' + imported.size + ' app modules the Worker bundles are watched by its deploy workflow.');
