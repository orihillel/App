import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BASEMAP } from './basemap.js';

// The parts of a KTX2 file's header that say what is inside it. The layout is fixed by the
// KTX 2.0 specification: a 12-byte identifier, nine 32-bit fields, then the index of where the
// data format descriptor and the levels are.
function readKtx2(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at) => view.getUint32(at, true);
  const identifier = Array.from(bytes.subarray(0, 12));
  const dfdOffset = u32(48);
  // The basic descriptor block starts 4 bytes into the descriptor (after its total size) and
  // has its colour model, primaries, transfer function and flags at bytes 8 to 11 of the block.
  const block = dfdOffset + 4;
  return {
    identifier,
    vkFormat: u32(12),
    width: u32(20),
    height: u32(24),
    layerCount: u32(32),
    faceCount: u32(36),
    levelCount: u32(40),
    supercompression: u32(44),
    colorModel: bytes[block + 8],
    transferFunction: bytes[block + 10],
  };
}

describe('the shipped base map', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../public/' + BASEMAP.file, import.meta.url)));
  const ktx2 = readKtx2(bytes);

  it('is a KTX2 file of the size the globe expects, with every mipmap level', () => {
    expect(ktx2.identifier).toEqual([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(ktx2.width).toBe(BASEMAP.width);
    expect(ktx2.height).toBe(BASEMAP.height);
    expect(ktx2.faceCount).toBe(1);
    // Down to 1x1: a compressed texture cannot have the GPU generate its mipmaps.
    expect(ktx2.levelCount).toBe(Math.log2(BASEMAP.width) + 1);
  });

  it('is Basis Universal ETC1S, the mode that stays small to download', () => {
    // vkFormat 0 means the format is the descriptor's to say; supercompression 1 is BasisLZ,
    // which only ETC1S uses; colour model 163 is KHR_DF_MODEL_ETC1S.
    expect(ktx2.vkFormat).toBe(0);
    expect(ktx2.supercompression).toBe(1);
    expect(ktx2.colorModel).toBe(163);
  });

  it('is marked as sRGB, so the colours of the photograph come through unchanged', () => {
    expect(ktx2.transferFunction).toBe(2); // KHR_DF_TRANSFER_SRGB
  });

  it('stays a small download', () => {
    // UASTC was 8MB for this image (see scripts/build-basemap.mjs). A rebuild that drifts back
    // toward that should fail here rather than on a phone.
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
  });
});
