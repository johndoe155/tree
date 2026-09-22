import * as THREE from "three";

/**
 * Soft radial falloff for the door-light quads.
 *
 * The falloff is baked into RGB (not alpha) on purpose: an opaque material's
 * alpha channel is forced to 1 by three.js, so an alpha-only sprite would come
 * out as a hard-edged square under additive blending. Black edges add nothing,
 * which is exactly the soft glow we want.
 */
export function createGlowTexture(size = 64, falloffPower = 3): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const falloff = Math.max(0, 1 - radius) ** falloffPower;
      const value = Math.round(falloff * 255);
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
