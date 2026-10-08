// Regenerates the globe's base map, public/basemap-*.ktx2: NASA's Blue Marble as a
// GPU-compressed texture.
//
// Run with: npm run build:basemap -- <source image>
//
// The source is NASA's Blue Marble Next Generation with topography and bathymetry, the December
// image (world.topo.bathy.200412), which is public domain -- the same imagery the globe used to
// fetch from NASA as a 5400x2700 JPEG. Pass a downloaded copy of any size with the 2:1 shape;
// it is resized to 4096x2048 here. The shipped file was built from the 4096x2048 copy in the
// three-globe package's examples (example/img/earth-blue-marble.jpg), because NASA's site could
// not be reached from where it was made.
//
// Why compressed: a JPEG has to be decompressed to raw pixels before a GPU can sample it, so the
// 5400x2700 image cost ~78MB of texture memory with its mipmaps, and handing it over blocked the
// main thread in one long call. A KTX2 file in Basis Universal's ETC1S mode stays compressed on
// the GPU: it is transcoded in a worker into a block format the device reads -- ETC1 on phones
// that support ETC, at 4 bits a pixel (~5.6MB with mipmaps); BC7 on most desktops, at 8 (~11MB).
//
// ETC1S rather than UASTC, measured on this image: UASTC was near-lossless (47 dB PSNR against
// the source) but 8MB, and still 6.6MB with rate-distortion optimisation -- too much to send a
// phone. ETC1S at the top quality setting is 1.2MB at 35.5 dB, and a globe drawn with it
// differs from one drawn with the JPEG by a mean of about 1 dE.
//
// Rows are stored south first. A compressed texture cannot be flipped on upload the way an
// image is, and the globe's texture coordinates run from the south pole up.
//
// The output name carries a version (BASEMAP in lib/basemap.js), for the reason the coastline's
// and the land mask's do: the service worker keeps it cache-first. Bump it whenever the
// contents change.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
import { BASEMAP } from '../src/lib/basemap.js';

const source = process.argv[2];
if (!source) {
  console.error('usage: npm run build:basemap -- <source image, 2:1 equirectangular>');
  process.exit(1);
}
const outPath = fileURLToPath(new URL('../public/' + BASEMAP.file, import.meta.url));

const started = Date.now();
const resized = await sharp(readFileSync(source))
  .resize(BASEMAP.width, BASEMAP.height, { fit: 'fill', kernel: 'lanczos3' })
  .png()
  .toBuffer();
const ktx2 = await encodeToKTX2(new Uint8Array(resized), {
  isUASTC: false,
  qualityLevel: 255,
  compressionLevel: 4,
  generateMipmap: true,
  isYFlip: true,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
  imageDecoder: async (buffer) => {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  },
});
writeFileSync(outPath, ktx2);

console.log('size      ', BASEMAP.width + 'x' + BASEMAP.height);
console.log('file      ', (ktx2.length / 1024 / 1024).toFixed(2) + 'MB');
console.log('took      ', ((Date.now() - started) / 1000).toFixed(1) + 's');
