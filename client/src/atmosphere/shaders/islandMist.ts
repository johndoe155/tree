import { NOISE, VERT } from "./common";

export const ISLAND_MIST_VERT = VERT;

/** Local-space mist. vUv is the island mist canvas (y=0 at the bottom, into the sea). */
export const ISLAND_MIST_FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uReducedMotion;
uniform float uIntensity;
uniform sampler2D uIsland;

in vec2 vUv;
out vec4 outColor;

${NOISE}

void main() {
  float motion = 1.0 - uReducedMotion;
  float t = uTime * motion;
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = uv * vec2(aspect, 1.0);

  float n1 = fbm(p * vec2(2.1, 2.8) + vec2(-t * 0.028, t * 0.01));
  float n2 = fbm(p * vec2(3.6, 4.4) + vec2(-t * 0.045, -t * 0.012));
  float n3 = fbm(p * 1.2 + vec2(-t * 0.012, 0.0));

  // Canvas is laid over PNG local x -0.18..1.18, y 0.40..1.20 (CSS, top-origin).
  vec2 pngCss = vec2(uv.x * 1.36 - 0.18, 0.40 + (1.0 - uv.y) * 0.80);
  float islandA = 0.0;
  if (pngCss.x > 0.0 && pngCss.x < 1.0 && pngCss.y > 0.0 && pngCss.y < 1.0) {
    islandA = texture(uIsland, clamp(pngCss, 0.001, 0.999)).a;
  }

  vec2 d = uv - vec2(0.50, 0.40);
  d.x += (n3 - 0.5) * 0.18;
  d.y += (n1 - 0.5) * 0.12;
  float ell = length(d / vec2(0.58, 0.52));
  float blob = 1.0 - smoothstep(0.20, 1.12, ell);

  float band = smoothstep(0.02, 0.28, uv.y) * (1.0 - smoothstep(0.72, 1.02, uv.y));
  float volume = mix(0.50, 1.0, n1) * mix(0.55, 1.0, n2);
  float mist = blob * band * volume * (0.65 + 0.85 * islandA);
  mist *= 2.35 * uIntensity;
  mist = clamp(mist, 0.0, 0.85);
  mist *= mix(1.0, 0.38, islandA);

  // Feather to alpha 0 well inside the canvas so the quad's left/right
  // (and top/bottom) edges never draw a hard seam against the sky.
  float edgeX = smoothstep(0.0, 0.22, uv.x) * (1.0 - smoothstep(0.78, 1.0, uv.x));
  float edgeY = smoothstep(0.0, 0.16, uv.y) * (1.0 - smoothstep(0.84, 1.0, uv.y));
  mist *= edgeX * edgeY;

  vec3 col = mix(vec3(0.80, 0.54, 0.78), vec3(0.96, 0.74, 0.82), n3);
  outColor = vec4(col * mist, mist * 0.90);
}`;
