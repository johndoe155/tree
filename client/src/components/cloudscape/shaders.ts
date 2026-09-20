import * as THREE from "three";

/**
 * Scene shaders.
 *
 * Every layer here writes *linear* values: the sky and the mist convert their hand-authored
 * display-space colours on the way out (sRGBTransferEOTF) and the PNG islands rely on three's
 * own sRGB decode + the composer's output encode, so all layers land in the same space and the
 * shared post-process can finish them together.
 *
 * The sky and the mist share one noise ladder so their cloud structure reads as the same stuff.
 */

const NOISE_LADDER = /* glsl */ `
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 4; i++) {
            value += amplitude * noise(p);
            p = p * 2.03 + 17.13;
            amplitude *= 0.5;
          }
          return value;
        }
`;

export const PLANE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * The cloudscape plate: the source photo driven by its own depth map for parallax drift.
 * Grain and the vertical grade used to live here; both moved to the shared finish pass so the
 * islands and the sky age together.
 */
export const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D uPhoto;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uReducedMotion;
uniform float uImageAspect;
/**
 * The plate is deliberately oversized so a resize can never expose a bare edge, which means its
 * uv spans more than the viewport. Folding that back out here keeps the photo landing on exactly
 * the pixels the old DOM layer showed.
 */
uniform float uCover;
varying vec2 vUv;

${NOISE_LADDER}

vec2 coverUv(vec2 uv) {
  float viewAspect = uResolution.x / uResolution.y;
  vec2 scale = vec2(1.0);
  if (viewAspect > uImageAspect) {
    scale.y = uImageAspect / viewAspect;
  } else {
    scale.x = viewAspect / uImageAspect;
  }
  return (uv - 0.5) * scale + 0.5;
}

void main() {
  vec2 uv = coverUv((vUv - 0.5) * uCover + 0.5);
  float depth = texture2D(uDepth, clamp(uv, 0.001, 0.999)).r;
  float cloudBand = smoothstep(0.30, 0.80, depth);

  float motion = 1.0 - uReducedMotion;
  float t = uTime * motion;
  float slowNoise = fbm(uv * vec2(2.25, 5.7) + vec2(t * 0.012, -t * 0.006));
  float fineNoise = noise(uv * 17.0 + vec2(-t * 0.018, t * 0.009));

  float parallax = mix(0.00065, 0.0035, smoothstep(0.05, 0.95, depth));
  float cloudDrift = t * parallax;
  // Upper streaks get their own faster lateral current so the sky never freezes while the
  // cloud sea moves below it.
  float upperSky = 1.0 - smoothstep(0.12, 0.54, depth);
  float upperDrift = t * 0.00225 * upperSky;
  float upperBreath = sin(t * 0.16 + uv.x * 5.0) * 0.00125 * upperSky;
  float billow = (slowNoise - 0.5) * (0.0018 + depth * 0.0048);
  float pointerX = uPointer.x * 0.003 * (0.25 + depth * 0.75);
  float pointerY = uPointer.y * 0.002 * (0.2 + depth * 0.8);

  float zoom = 1.012 + 0.006 * sin(t * 0.11);
  uv = (uv - 0.5) / zoom + 0.5;
  uv += vec2(cloudDrift + upperDrift + billow + pointerX,
             pointerY + upperBreath + sin(t * 0.08 + uv.x * 4.0) * 0.0008 * motion);

  // The plate is authored in display space, so all of its grading maths happens there too.
  vec3 color = sRGBTransferOETF(texture2D(uPhoto, clamp(uv, 0.001, 0.999))).rgb;

  // A translucent procedural haze keeps the original pixels dominant while giving the cloud sea air.
  float haze = smoothstep(0.42, 0.98, depth) * (0.16 + 0.18 * slowNoise) * motion;
  vec3 lavenderFog = vec3(0.60, 0.34, 0.66);
  color = mix(color, lavenderFog, haze * 0.075);
  color += vec3(0.013, 0.004, 0.013) * (cloudBand * fineNoise);

  gl_FragColor = vec4(sRGBTransferEOTF(vec4(clamp(color, 0.0, 1.0), 1.0)).rgb, 1.0);
}
`;

/**
 * A wisp band. The colours are handled in *display* space (the same space the still photograph
 * lives in) because that is where the shading reads the way it was tuned; the single
 * `sRGBTransferEOTF` on the way out is what puts the band back into the scene's linear buffer,
 * so it blooms, grades and grains exactly like everything else in the frame.
 */
/** Authored colours are hex-derived (linear in three); the mist maths wants display values. */
const toDisplaySpace = (color: THREE.Color) =>
  color.clone().convertLinearToSRGB();

export type MistUniformValues = {
  seed: number;
  frequency: [number, number];
  thinness: number;
  opacity: number;
  erosion: number;
  drift: number;
  yBias: number;
  lit: THREE.Color;
  shadow: THREE.Color;
};

/** One drifting band of vapour. Alpha only: it never writes depth, so islands still occlude it. */
export const MIST_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReducedMotion;
uniform float uSeed;
uniform vec2 uFrequency;
uniform float uThinness;
uniform float uOpacity;
uniform float uErosion;
uniform float uDrift;
uniform float uYBias;
uniform vec3 uLitColor;
uniform vec3 uShadowColor;
varying vec2 vUv;

${NOISE_LADDER}

void main() {
  float t = uTime * (1.0 - uReducedMotion);
  vec2 window = vec2(vUv.x, vUv.y * (1.0 - 2.0 * uYBias) + uYBias);
  vec2 p = (window - 0.5) * uFrequency + vec2(t * uDrift, 0.0);

  float shape = fbm(p + uSeed);
  float lighting = fbm(p * 2.17 + uSeed * 3.13 + 11.7);
  float erode = fbm(p * 3.9 + uSeed * 7.77 + 5.1);

  // Ridge the band so it breaks into filaments instead of puffing into balls.
  float ridge = 1.0 - abs(2.0 * shape - 1.0);
  float alpha = pow(clamp(ridge, 0.0, 1.0), uThinness);
  alpha *= smoothstep(0.0, 0.3, window.x) * (1.0 - smoothstep(0.7, 1.0, window.x));
  alpha *= smoothstep(0.0, 0.34, window.y) * (1.0 - smoothstep(0.66, 1.0, window.y));
  alpha *= mix(0.3 + 0.7 * smoothstep(0.28, 0.74, erode), 1.0, 1.0 - uErosion);
  alpha = clamp(alpha, 0.0, 1.0) * uOpacity;

  float lit = clamp(0.18 + lighting * 1.25, 0.0, 1.0);
  vec3 color = mix(uShadowColor, uLitColor, lit);
  // Nudge the tone toward the sky the band is drifting through so it never reads as a sticker.
  color += vec3(0.02, -0.012, 0.03) * (window.y - 0.5) * 2.0;

  gl_FragColor = vec4(sRGBTransferEOTF(vec4(clamp(color, 0.0, 1.0), 1.0)).rgb, alpha);
}
`;

export function createMistMaterial(values: MistUniformValues) {
  const uniforms = {
    uTime: { value: 0 },
    uReducedMotion: { value: 0 },
    uSeed: { value: values.seed },
    uFrequency: { value: new THREE.Vector2(...values.frequency) },
    uThinness: { value: values.thinness },
    uOpacity: { value: values.opacity },
    uErosion: { value: values.erosion },
    uDrift: { value: values.drift },
    uYBias: { value: values.yBias },
    uLitColor: { value: toDisplaySpace(values.lit) },
    uShadowColor: { value: toDisplaySpace(values.shadow) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PLANE_VERTEX,
    fragmentShader: MIST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    // Clouds are made of the sky's own light, so scene fog must not wash them out again.
    fog: false,
  });
  return { material, uniforms };
}

/**
 * Unlit material for the PNG islands. It keeps three's own `<fog_...>` chunks untouched, which
 * is what gives the islands their atmospheric perspective for free; the only thing patched in is
 * the tiny depth-of-field softening, applied to the texture sample (colour *and* alpha) so the
 * cutout edges lose their hard pixel staircase too.
 */
export function createIslandMaterial(texture: THREE.Texture) {
  const blur = { value: new THREE.Vector2(0, 0) };
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  material.fog = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uIslandBlur = blur;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec2 uIslandBlur;
        vec4 sampleIslandPlate(sampler2D plate, vec2 plateUv) {
          vec2 tap = uIslandBlur;
          vec4 sum = texture2D(plate, plateUv) * 4.0;
          sum += texture2D(plate, plateUv + vec2(-tap.x, 0.0)) * 2.0;
          sum += texture2D(plate, plateUv + vec2(tap.x, 0.0)) * 2.0;
          sum += texture2D(plate, plateUv + vec2(0.0, -tap.y)) * 2.0;
          sum += texture2D(plate, plateUv + vec2(0.0, tap.y)) * 2.0;
          sum += texture2D(plate, plateUv + vec2(-tap.x, -tap.y));
          sum += texture2D(plate, plateUv + vec2(tap.x, -tap.y));
          sum += texture2D(plate, plateUv + vec2(-tap.x, tap.y));
          sum += texture2D(plate, plateUv + vec2(tap.x, tap.y));
          return sum / 16.0;
        }
        `
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = sampleIslandPlate(map, vMapUv);
          diffuseColor *= sampledDiffuseColor;
        #endif
        `
      );
  };
  material.userData.blur = blur;
  material.needsUpdate = true;
  return material;
}
