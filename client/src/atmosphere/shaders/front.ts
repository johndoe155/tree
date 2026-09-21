import { NOISE, VERT } from "./common";

export const FRONT_VERT = VERT;

export const FRONT_FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uReducedMotion;
uniform float uIntensity;
uniform float uMist;
uniform float uRays;
uniform float uVignette;
uniform float uForeground;
uniform float uLife;

uniform sampler2D uTreeTex;
uniform sampler2D uStatueTex;
uniform vec4 uTreeBox;
uniform vec4 uStatueBox;

in vec2 vUv;
out vec4 outColor;

${NOISE}

vec2 cssUv(vec2 uv) { return vec2(uv.x, 1.0 - uv.y); }

float islandAlpha(sampler2D tex, vec4 box, vec2 css) {
  if (box.z < 0.001 || box.w < 0.001) return 0.0;
  vec2 local = (css - box.xy) / box.zw;
  if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return 0.0;
  return texture(tex, clamp(local, 0.001, 0.999)).a;
}

// Soft occupancy of the ROCK only (lower half of the PNG). No silhouette dilation —
// that was producing the desaturated outline around each island.
float rockField(sampler2D tex, vec4 box, vec2 css, vec2 p, float t, vec2 centerBias) {
  if (box.z < 0.001 || box.w < 0.001) return 0.0;
  vec2 local = (css - box.xy) / box.zw;
  // Allow sampling a little below/beside the box so mist can merge into the sea.
  if (local.x < -0.25 || local.x > 1.25 || local.y < 0.28 || local.y > 1.45) return 0.0;

  // Rock mass sits in the lower-middle of each island PNG.
  vec2 rockC = vec2(0.50, 0.70) + centerBias;
  vec2 d = local - rockC;
  float warp = fbm(p * 2.2 + vec2(-t * 0.025, t * 0.01)) - 0.5;
  d.x += warp * 0.14;
  d.y += (fbm(p * 1.6 + 9.1) - 0.5) * 0.10;
  float ell = length(d / vec2(0.48, 0.42));
  float blob = 1.0 - smoothstep(0.35, 1.35, ell);

  // Never ring the canopy / statue head.
  float lower = smoothstep(0.42, 0.62, local.y);
  // Column of mist from the cliff tip down into the cloud sea.
  float under = smoothstep(0.58, 0.82, local.y) * (1.0 - smoothstep(1.05, 1.48, local.y));
  float sideFade = 1.0 - smoothstep(0.42, 0.62, abs(local.x - 0.5));

  float inside = 0.0;
  if (local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0) {
    inside = texture(tex, clamp(local, 0.001, 0.999)).a;
  }
  float cling = blob * lower * (0.25 + 0.55 * inside + 1.15 * under) * mix(0.75, 1.0, sideFade);
  return clamp(cling, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 css = cssUv(uv);
  float motion = 1.0 - uReducedMotion;
  float t = uTime * motion;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = uv * vec2(aspect, 1.0);

  float n1 = fbm(p * vec2(1.6, 2.2) + vec2(-t * 0.020, t * 0.006) + uPointer * 0.04);
  float n2 = fbm(p * vec2(3.1, 3.8) + vec2(-t * 0.034, -t * 0.008) + uPointer * 0.07);
  float n3 = fbm(p * vec2(0.9, 1.3) + vec2(-t * 0.01, t * 0.002));

  float treeA = islandAlpha(uTreeTex, uTreeBox, css);
  float statueA = islandAlpha(uStatueTex, uStatueBox, css);
  float onIsland = max(treeA, statueA);

  float treeRock = rockField(uTreeTex, uTreeBox, css, p, t, vec2(0.02, 0.0));
  float statueRock = rockField(uStatueTex, uStatueBox, css, p, t, vec2(-0.02, 0.02));

  // Billowy volume: holes in the fbm so it never fills a solid patch.
  float volume = mix(0.35, 1.0, n1) * mix(0.55, 1.0, n2);
  float mist = volume * (treeRock + statueRock) * 1.35 * uMist * uIntensity;
  mist = clamp(mist, 0.0, 0.78);
  mist *= mix(1.0, 0.38, onIsland);

  vec3 mistCol = mix(vec3(0.82, 0.56, 0.80), vec3(0.96, 0.74, 0.80), n3);
  vec3 color = mistCol * mist;
  float alpha = mist * 0.82;

  if (uRays > 0.5) {
    vec2 sun = vec2(1.18, 0.44);
    vec2 dir = uv - sun;
    float ang = atan(dir.y, dir.x);
    float dist = length(dir * vec2(aspect, 1.0));
    float shafts = pow(max(0.0, sin(ang * 9.0 + t * 0.06 + n3 * 1.2)), 6.0);
    shafts *= 0.55 + 0.45 * noise(vec2(ang * 5.0, t * 0.04));
    float sky = smoothstep(0.18, 0.46, uv.y) * (1.0 - smoothstep(0.54, 0.82, uv.y));
    float fromRight = smoothstep(0.18, 0.95, uv.x);
    float rays = shafts * sky * fromRight * exp(-dist * 0.42) * 0.11 * uIntensity;
    rays *= 1.0 - onIsland * 0.7;
    color += vec3(1.0, 0.72, 0.48) * rays;
    alpha = max(alpha, rays * 1.4);
  }

  if (uVignette > 0.5) {
    vec2 vc = (uv - 0.5) * vec2(1.15, 1.0);
    float vig = smoothstep(0.42, 1.05, length(vc));
    float vAmt = vig * 0.18 * uIntensity;
    color = mix(color, vec3(0.04, 0.02, 0.08) * vAmt, vAmt);
    alpha = max(alpha, vAmt * 0.55);
  }

  if (uForeground > 0.5) {
    float edge = max(smoothstep(0.78, 1.0, 1.0 - uv.y), max(smoothstep(0.88, 1.0, uv.x), smoothstep(0.88, 1.0, 1.0 - uv.x)));
    edge = max(edge, smoothstep(0.92, 1.0, uv.y) * 0.4);
    float bokeh = fbm(p * 1.1 + vec2(-t * 0.05, 0.0) + uPointer * 0.12);
    float fg = edge * smoothstep(0.42, 0.82, bokeh) * 0.22 * uIntensity;
    color += vec3(0.78, 0.52, 0.72) * fg;
    alpha = max(alpha, fg);

    vec2 leafUv = uv + vec2(-t * 0.006, sin(t * 0.2) * 0.004) * motion;
    float leaf1 = exp(-pow(length((leafUv - vec2(0.04, 0.08)) * vec2(aspect * 1.6, 2.4)), 2.0) * 18.0);
    float leaf2 = exp(-pow(length((leafUv - vec2(0.96, 0.18)) * vec2(aspect * 1.8, 2.2)), 2.0) * 16.0);
    float leaf3 = exp(-pow(length((leafUv - vec2(0.08, 0.92)) * vec2(aspect * 1.4, 2.0)), 2.0) * 14.0);
    float leaves = (leaf1 + leaf2 * 0.7 + leaf3 * 0.5) * 0.12 * uIntensity;
    color += vec3(0.55, 0.28, 0.48) * leaves;
    alpha = max(alpha, leaves);
  }

  float rim = 0.0;
  {
    vec2 sunOff = vec2(-6.0 / uResolution.x, 1.5 / uResolution.y);
    float tA = islandAlpha(uTreeTex, uTreeBox, css);
    float tB = islandAlpha(uTreeTex, uTreeBox, css + sunOff);
    float sA = islandAlpha(uStatueTex, uStatueBox, css);
    float sB = islandAlpha(uStatueTex, uStatueBox, css + sunOff);
    rim = max(tA * (1.0 - tB), sA * (1.0 - sB));
    rim = pow(rim, 0.85) * 0.22 * uIntensity;
    color += vec3(1.0, 0.78, 0.42) * rim;
    alpha = max(alpha, rim);
  }

  if (uLife > 0.5 && motion > 0.5) {
    float petals = 0.0;
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float seed = hash21(vec2(fi * 13.7, 4.2));
      float seed2 = hash21(vec2(fi * 7.1, 9.3));
      float lifeT = fract(t * (0.018 + seed * 0.012) + seed2);
      vec2 origin = mix(uTreeBox.xy + uTreeBox.zw * vec2(0.55, 0.28),
                        uStatueBox.xy + uStatueBox.zw * vec2(0.45, 0.38),
                        step(0.5, seed));
      if (uTreeBox.z < 0.001) origin = vec2(0.18, 0.28);
      vec2 pos = origin + vec2(-lifeT * 0.22 - seed * 0.04, lifeT * 0.12 + sin(lifeT * 6.28 + seed * 6.0) * 0.03);
      pos.y = 1.0 - pos.y;
      float d = length((uv - pos) * vec2(aspect, 1.0));
      float fade = smoothstep(0.0, 0.12, lifeT) * (1.0 - smoothstep(0.75, 1.0, lifeT));
      petals += (1.0 - smoothstep(0.0018, 0.0065, d)) * fade * 0.55;
    }
    petals *= 0.35 * uIntensity;
    color += vec3(0.92, 0.55, 0.72) * petals;
    alpha = max(alpha, petals);
  }

  outColor = vec4(color, clamp(alpha, 0.0, 0.85));
}`;
