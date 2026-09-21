import { NOISE, VERT } from "./common";

export const BACK_VERT = VERT;

export const BACK_FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uReducedMotion;
uniform float uIntensity;
uniform float uSunGlow;
uniform float uLife;

in vec2 vUv;
out vec4 outColor;

${NOISE}

void main() {
  vec2 uv = vUv;
  float motion = 1.0 - uReducedMotion;
  float t = uTime * motion;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = uv * vec2(aspect, 1.0);

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  // Horizon sun glow — off-frame right, y ~ 0.44. Behind islands so house is haloed.
  if (uSunGlow > 0.5) {
    vec2 sun = vec2(1.08, 0.44);
    vec2 d = (uv - sun) * vec2(aspect * 0.55, 1.15);
    float glow = exp(-dot(d, d) * 3.4);
    float band = smoothstep(0.28, 0.42, uv.y) * (1.0 - smoothstep(0.50, 0.72, uv.y));
    float right = smoothstep(0.35, 1.05, uv.x);
    float g = glow * band * right * 0.22 * uIntensity;
    color += vec3(1.0, 0.62, 0.38) * g;
    color += vec3(1.0, 0.82, 0.55) * g * 0.45;
    alpha = max(alpha, g * 1.1);
  }

  // Far slow wisp plane — slower than the photo, sits just in front of the sea.
  float n = fbm(p * vec2(1.2, 2.0) + vec2(-t * 0.006, t * 0.0015) + uPointer * 0.015);
  float sea = smoothstep(0.05, 0.35, uv.y) * (1.0 - smoothstep(0.55, 0.78, uv.y));
  float side = 0.45 + 0.55 * (1.0 - smoothstep(0.12, 0.42, min(uv.x, 1.0 - uv.x)));
  float wisp = smoothstep(0.42, 0.80, n) * sea * side * 0.14 * uIntensity;
  color += vec3(0.72, 0.48, 0.70) * wisp;
  alpha = max(alpha, wisp);

  // Distant birds: hashed silhouettes crossing the horizon band.
  if (uLife > 0.5 && motion > 0.5) {
    float birds = 0.0;
    for (int f = 0; f < 2; f++) {
      float ff = float(f);
      float seed = hash21(vec2(ff + 2.2, 8.1));
      float speed = 0.012 + seed * 0.008;
      float y0 = 0.52 + seed * 0.08 + float(f) * 0.04;
      float x0 = fract(t * speed + seed);
      // flock of 5
      for (int b = 0; b < 5; b++) {
        float bb = float(b);
        float ox = (bb - 2.0) * 0.012 + sin(t * 0.7 + bb) * 0.003;
        float oy = abs(bb - 2.0) * 0.006 + sin(t * 1.6 + bb * 2.0) * 0.002;
        vec2 pos = vec2(x0 + ox, y0 + oy);
        vec2 dlt = (uv - pos) * vec2(aspect, 1.0);
        // chevron wing
        float flap = 0.55 + 0.45 * sin(t * 8.0 + bb * 1.7);
        float wing = smoothstep(0.004, 0.0012, abs(dlt.y - flap * abs(dlt.x) * 0.55) ) * (1.0 - smoothstep(0.008, 0.014, abs(dlt.x)));
        birds += wing * 0.55;
      }
    }
    birds *= 0.35 * uIntensity;
    color += vec3(0.18, 0.10, 0.22) * birds;
    alpha = max(alpha, birds);
  }

  outColor = vec4(color, clamp(alpha, 0.0, 0.6));
}`;
