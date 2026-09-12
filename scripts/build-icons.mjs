// Rasterizes scripts/icon-source.svg into the PNG sizes the PWA manifest and
// index.html need — regenerate with `npm run build:icons` if the source
// artwork changes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    .toFile(join(outDir, file));
  console.log(`Wrote public/icons/${file} (${size}x${size})`);
}

// The link-preview card, from its own artwork rather than the square icon.
//
// 1200x630 is what Open Graph and Twitter both want, and it is a landscape card with room for
// words -- an upscaled square app icon in that slot reads as a mistake. It carries the app name
// because the route lives in the URL hash, which never reaches a crawler: no preview can ever
// know which spot a shared link points at, so naming the app is the only honest thing it can do.
const cardSvg = readFileSync(fileURLToPath(new URL('./og-card.svg', import.meta.url)));
await sharp(cardSvg, { density: 192 })
  .resize(1200, 630)
  .png()
  .toFile(join(outDir, 'og-card.png'));
console.log('Wrote public/icons/og-card.png (1200x630)');
