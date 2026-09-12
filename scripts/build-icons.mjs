// Rasterizes the wave mark (scripts/wave-mark.mjs) into the PNG sizes the PWA manifest,
// index.html and the link-preview card need — regenerate with `npm run build:icons` if the
// mark's parameters change.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { waveMarkSvg, waveMarkGroup } from './wave-mark.mjs';

const outDir = fileURLToPath(new URL('../public/icons', import.meta.url));

const targets = [
  { file: 'icon-192.png', size: 192, svg: waveMarkSvg() },
  { file: 'icon-512.png', size: 512, svg: waveMarkSvg() },
  // The maskable slot gets the inset variant -- see wave-mark.mjs for why the full-bleed
  // artwork above cannot double as this one.
  { file: 'icon-maskable-512.png', size: 512, svg: waveMarkSvg({ maskableSafe: true }) },
  // iOS ignores manifest icons and wants its own opaque, un-rounded square.
  { file: 'apple-touch-icon.png', size: 180, svg: waveMarkSvg() },
  { file: 'favicon-32.png', size: 32, svg: waveMarkSvg() },
];

for (const { file, size, svg } of targets) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(outDir, file));
  console.log(`Wrote public/icons/${file} (${size}x${size})`);
}

// The link-preview card, built from the same mark rather than a second hand-drawn wave --
// before this they were two separate pieces of art and had already drifted (the card's wave
// used plain wavy strokes, the icon a proper curl) without anyone deciding they should differ.
//
// 1200x630 is what Open Graph and Twitter both want, and it is a landscape card with room for
// words -- an upscaled square app icon in that slot reads as a mistake. It carries the app name
// because the route lives in the URL hash, which never reaches a crawler: no preview can ever
// know which spot a shared link points at, so naming the app is the only honest thing it can do.
const CARD_W = 1200, CARD_H = 630;
const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="#070F18"/>
  ${waveMarkGroup({ cx: 920, cy: 315, scale: 1.05 })}
  <text x="88" y="286" font-family="Verdana, DejaVu Sans, sans-serif" font-size="104" font-weight="700" fill="#F4F7F6" letter-spacing="-2">Surfcast</text>
  <text x="92" y="348" font-family="Verdana, DejaVu Sans, sans-serif" font-size="34" fill="#8FA6B2">Live surf, rated for your board</text>
</svg>`;
await sharp(Buffer.from(cardSvg), { density: 192 })
  .resize(CARD_W, CARD_H)
  .png()
  .toFile(join(outDir, 'og-card.png'));
console.log('Wrote public/icons/og-card.png (1200x630)');
