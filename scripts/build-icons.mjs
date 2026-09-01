// Rasterizes scripts/icon-source.svg into the PNG sizes the PWA manifest and
// index.html need — regenerate with `npm run build:icons` if the source
// artwork changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const srcPath = fileURLToPath(new URL('./icon-source.svg', import.meta.url));
const outDir = fileURLToPath(new URL('../public/icons', import.meta.url));
const svg = readFileSync(srcPath);

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // Same artwork reused for the maskable slot — the wave mark already sits
  // well inside the safe zone, so no separate padded version is needed.
  { file: 'icon-maskable-512.png', size: 512 },
  // iOS ignores manifest icons and wants its own opaque, un-rounded square.
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
];

for (const { file, size } of targets) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`../public/icons/${file}`, import.meta.url)));
  console.log(`Wrote public/icons/${file} (${size}x${size})`);
}
