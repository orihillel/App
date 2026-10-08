import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BASEMAP, muteBasemap, mutedColor } from './basemap.js';

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

describe('muteBasemap', () => {
  const phong = () => ({ ...THREE.ShaderLib.phong, uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.phong.uniforms) });

  it('patches three\'s own Phong shader, after the map is read and before it is lit', () => {
    const shader = phong();
    const uniforms = { uMute: { value: 0 }, uMuteMask: { value: null }, uMuteHasMask: { value: 0 } };
    expect(muteBasemap(shader, uniforms)).toBe(true);
    expect(shader.uniforms.uMute).toBe(uniforms.uMute); // the same object, so the fade is one write
    const frag = shader.fragmentShader;
    expect(frag.indexOf('diffuseColor.rgb = mix( diffuseColor.rgb, muted, uMute )'))
      .toBeGreaterThan(frag.indexOf('#include <map_fragment>'));
    expect(frag.indexOf('diffuseColor.rgb = mix( diffuseColor.rgb, muted, uMute )'))
      .toBeLessThan(frag.indexOf('#include <lights_fragment_begin>'));
    expect(shader.vertexShader).toContain('vMuteUv = uv;');
  });

  it('leaves a shader it does not recognise alone, rather than breaking the globe', () => {
    const shader = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}', uniforms: {} };
    expect(muteBasemap(shader, { uMute: { value: 1 } })).toBe(false);
    expect(shader.fragmentShader).toBe('void main() {}');
    expect(shader.uniforms.uMute).toBeUndefined();
  });
});

describe('mutedColor', () => {
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat = (c) => Math.max(...c) - Math.min(...c);

  it('turns the sea one flat dark colour whatever the photograph shows there', () => {
    expect(mutedColor([0.01, 0.03, 0.08], 0)).toEqual(mutedColor([0.05, 0.2, 0.3], 0));
    expect(lum(mutedColor([0.05, 0.2, 0.3], 0))).toBeLessThan(0.02);
  });

  it('keeps land\'s light and shade, in grey rather than green and brown', () => {
    const forest = mutedColor([0.02, 0.05, 0.01], 1);
    const desert = mutedColor([0.35, 0.25, 0.12], 1);
    const ice = mutedColor([0.8, 0.82, 0.85], 1);
    expect(lum(forest)).toBeLessThan(lum(desert));
    expect(lum(desert)).toBeLessThan(lum(ice));
    for (const c of [forest, desert, ice]) expect(sat(c)).toBeLessThan(0.1);
  });

  it('keeps land lighter than the sea, so the coast still reads', () => {
    expect(lum(mutedColor([0.02, 0.05, 0.01], 1))).toBeGreaterThan(lum(mutedColor([0.02, 0.05, 0.01], 0)));
  });
});
