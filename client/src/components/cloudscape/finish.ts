import { createEffectComponent } from "@react-three/postprocessing";
import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";
import {
  GRADE_CONTRAST,
  GRADE_GRAIN,
  GRADE_LIFT,
  GRADE_SATURATION,
  GRADE_SHADOW_TINT,
  GRADE_VIGNETTE,
} from "./constants";

/**
 * The shared finish: one pass over the composited frame, so the sky plate, the PNG islands and
 * the .glb all sit under the same grain, the same glow and the same grade. Nothing here is per
 * object any more, which is the point: it is what stops the cut-out islands from looking like
 * stickers laid on top of the sky.
 *
 * Grading happens in display space (the frame is decoded on entry and re-encoded on exit) so the
 * numbers behave the way they would in any still-image editor, and so bloom keeps working on the
 * linear values upstream of it.
 */
const FinishFragment = /* glsl */ `
uniform vec3 uShadowTint;
uniform float uLift;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = sRGBTransferOETF(inputColor).rgb;

  // Fade the blacks toward a cool haze rather than crushing them: a filmic toe that lowers the
  // contrast of the whole frame at once, islands included.
  color = color * (1.0 - uLift) + uShadowTint * uLift;

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);
  color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);

  float radius = length((uv - 0.5) * vec2(aspect, 1.0));
  color *= 1.0 - uVignette * smoothstep(0.42, 1.02, radius);

  // One grain field over everything; the per-layer grain used to make the sky and the islands
  // age at different rates.
  float grain = hash21(gl_FragCoord.xy + vec2(uTime * 3.0)) - 0.5;
  color = clamp(color + grain * uGrain * (0.55 + 0.45 * (1.0 - luma)), 0.0, 1.0);

  outputColor = vec4(sRGBTransferEOTF(vec4(color, 1.0)).rgb, inputColor.a);
}
`;

const shadowTint = new THREE.Color(GRADE_SHADOW_TINT).convertLinearToSRGB();

export type CloudscapeFinishProps = {
  shadowTint?: THREE.Color;
  lift?: number;
  contrast?: number;
  saturation?: number;
  vignette?: number;
  grain?: number;
  time?: number;
  blendFunction?: BlendFunction;
};

export class CloudscapeFinishEffect extends Effect {
  private _u: {
    uShadowTint: THREE.Uniform<THREE.Color>;
    uLift: THREE.Uniform<number>;
    uContrast: THREE.Uniform<number>;
    uSaturation: THREE.Uniform<number>;
    uVignette: THREE.Uniform<number>;
    uGrain: THREE.Uniform<number>;
    uTime: THREE.Uniform<number>;
  };

  constructor({
    shadowTint: tint = shadowTint,
    lift = GRADE_LIFT,
    contrast = GRADE_CONTRAST,
    saturation = GRADE_SATURATION,
    vignette = GRADE_VIGNETTE,
    grain = GRADE_GRAIN,
    time = 0,
    blendFunction = BlendFunction.NORMAL,
  }: CloudscapeFinishProps = {}) {
    const uniforms = new Map<string, THREE.Uniform>([
      ["uShadowTint", new THREE.Uniform(tint.clone())],
      ["uLift", new THREE.Uniform(lift)],
      ["uContrast", new THREE.Uniform(contrast)],
      ["uSaturation", new THREE.Uniform(saturation)],
      ["uVignette", new THREE.Uniform(vignette)],
      ["uGrain", new THREE.Uniform(grain)],
      ["uTime", new THREE.Uniform(time)],
    ]);
    super("CloudscapeFinish", FinishFragment, { blendFunction, uniforms });
    this._u = uniforms as unknown as CloudscapeFinishEffect["_u"];
  }

  /** Accepts a linear working-space colour, like every other colour in the scene. */
  set shadowTint(value: THREE.Color) {
    this._u.uShadowTint.value.copy(value).convertLinearToSRGB();
  }

  set lift(value: number) {
    this._u.uLift.value = value;
  }

  set contrast(value: number) {
    this._u.uContrast.value = value;
  }

  set saturation(value: number) {
    this._u.uSaturation.value = value;
  }

  set vignette(value: number) {
    this._u.uVignette.value = value;
  }

  set grain(value: number) {
    this._u.uGrain.value = value;
  }

  get time() {
    return this._u.uTime.value;
  }

  set time(value: number) {
    this._u.uTime.value = value;
  }
}

export const CloudscapeFinish = createEffectComponent<
  typeof CloudscapeFinishEffect,
  CloudscapeFinishProps
>(CloudscapeFinishEffect);
