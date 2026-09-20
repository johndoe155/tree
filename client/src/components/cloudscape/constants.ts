/**
 * Shared numbers for the cloudscape scene.
 *
 * Everything that decides how the layers relate to each other in depth lives here:
 * the scene fog (atmospheric perspective), the placement of the billboarded PNG islands,
 * the mist that overlaps their lower tips, and the single post-process that finishes
 * the PNGs and the .glb with the same grain, bloom and grade.
 */

export const MODEL_URL = "/model.glb";
export const TREE_URL = "/tree-island.png";
export const STATUE_URL = "/statue-island.png";
export const PHOTO_URL = "/cloudscape-source.webp";
export const DEPTH_URL = "/cloudscape-depth.webp";
export const HDRI_URL_MOBILE = "/studio_small_08_1k.hdr";
export const HDRI_URL_DESKTOP = "/studio_small_08_4k.hdr";

/** The .glb faces -z; turning it a quarter turn puts its good side to the camera. */
export const MODEL_ROTATION_Y = -Math.PI / 2;

/* ---------------------------------------------------------------- camera */
export const CAMERA_POSITION: [number, number, number] = [0, 0.15, 5.8];
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 120;
export const BASE_FOV = 32;
export const MOBILE_FOV = 38;
/** How much of the smaller viewport axis the centre island fills. */
export const VIEWPORT_FIT_FACTOR = 0.78;
/** Depth of the sky plane in view space; it is billboarded, so any value inside `far` works. */
export const SKY_VIEW_DEPTH = 60;
/** Oversize factor for the sky plane so its edges can never reach the viewport. */
export const SKY_COVER = 1.08;

/* ------------------------------------------------------------------ finish */
export const STUDIO_EXPOSURE = 0.68;
export const STUDIO_ENV_INTENSITY = 0.48;
export const KEY_LIGHT_INTENSITY = 2.4;

/** Scene clear colour; also the CSS background, so the load-in never flashes. */
export const NIGHT_BLUE = "#171331";

/**
 * Atmospheric perspective. The colour is the mean of the sky and cloud tops the side
 * islands actually sit against (sampled from the source photo across that band).
 * three.js mixes fog *after* tone mapping, inside the composer's linear buffer, so
 * small factors go a long way: 6% at the side islands already lifts their blacks.
 */
export const FOG_COLOR = "#8f7bad";
/** Fog start, as a fraction of the fitted island size behind the camera-facing centre. */
export const FOG_NEAR_OFFSET = 0.06;
/** Total span of the fog ramp; the side islands land ~6% into it (see FOG_ISLAND_DEPTH). */
export const FOG_SPAN_FACTOR = 5.75;

/** Depth of the PNG islands, as a fraction of the fitted centre island size behind it. */
export const ISLAND_VIEW_DEPTH = 0.9;
/** The band that drifts between the centre island and the PNG islands. */
export const MIST_FAR_DEPTH = 0.55;
/** Wisps that pass in front of everything. */
export const MIST_NEAR_DEPTH = -0.55;

/**
 * Softening applied to the PNG islands only: they sit a whole island behind the centre, so a
 * hair of defocus sells it. This is the tap radius of a 3x3 gaussian in CSS pixels, i.e. about
 * 0.7px of sigma - small enough that the islands stay readable.
 */
export const ISLAND_FOCUS_BLUR_PX = 1.6;

export const BLOOM_INTENSITY = 0.34;
export const BLOOM_LUMINANCE_THRESHOLD = 0.4;
export const BLOOM_LUMINANCE_SMOOTHING = 0.35;
export const BLOOM_RADIUS = 0.72;

export const GRADE_LIFT = 0.052;
export const GRADE_CONTRAST = 1.035;
export const GRADE_SATURATION = 0.955;
/** Colour the lifted blacks fade into; a cool haze, deliberately darker than the fog colour. */
export const GRADE_SHADOW_TINT = "#4d4366";
export const GRADE_VIGNETTE = 0.16;
export const GRADE_GRAIN = 0.017;

/* ----------------------------------------------------------------- motion */
export const FLOAT_SPEED = 1.1;
export const FLOAT_AMPLITUDE_BASE = 0.05;

/* ------------------------------------------------- side islands (was css) */
/**
 * The PNGs are billboarded planes, so their *screen* size and anchor are still driven by
 * the same clamps the CSS layer used. `topAxis` is where the top edge of the image sits,
 * because the float keyframes replaced `transform: translateY(-50%)` in the old layer.
 */
export type SideIslandSpec = {
  url: string;
  /** Source pixel size, needed to keep the aspect ratio of the image box. */
  sourceWidth: number;
  sourceHeight: number;
  /** Where the lower tip of the island sits inside the image box, in 0..1 image space. */
  tipX: number;
  tipY: number;
  minWidth: number;
  widthVw: number;
  maxWidth: number;
  minWidthSm: number;
  widthVwSm: number;
  maxWidthSm: number;
  minWidthXs: number;
  widthVwXs: number;
  maxWidthXs: number;
  offsetMin: number;
  offsetVw: number;
  offsetMax: number;
  offsetSm: number;
  offsetXs: number;
  floatPeriod: number;
  floatDelay: number;
  /** Keyframe stops from the old CSS animation: [progress, offsetY px, rotation deg]. */
  floatStops: ReadonlyArray<readonly [number, number, number]>;
};

export const TREE_ISLAND: SideIslandSpec = {
  url: TREE_URL,
  sourceWidth: 989,
  sourceHeight: 1589,
  tipX: 0.626,
  tipY: 0.863,
  minWidth: 178,
  widthVw: 0.255,
  maxWidth: 340,
  minWidthSm: 142,
  widthVwSm: 0.27,
  maxWidthSm: 255,
  minWidthXs: 102,
  widthVwXs: 0.27,
  maxWidthXs: 148,
  offsetMin: 24,
  offsetVw: 0.045,
  offsetMax: 58,
  offsetSm: 18,
  offsetXs: 14,
  floatPeriod: 8.8,
  floatDelay: -2.1,
  floatStops: [
    [0.0, 0, -1],
    [0.09, 0, -1],
    [0.3, -3, 0.25],
    [0.34, -3, 0.25],
    [0.63, 3, -0.2],
    [0.67, 3, -0.2],
    [0.92, 0, -1],
    [1.0, 0, -1],
  ],
};

export const STATUE_ISLAND: SideIslandSpec = {
  url: STATUE_URL,
  sourceWidth: 941,
  sourceHeight: 1672,
  tipX: 0.402,
  tipY: 0.887,
  minWidth: 168,
  widthVw: 0.235,
  maxWidth: 312,
  minWidthSm: 132,
  widthVwSm: 0.24,
  maxWidthSm: 232,
  minWidthXs: 95,
  widthVwXs: 0.23,
  maxWidthXs: 134,
  offsetMin: 24,
  offsetVw: 0.045,
  offsetMax: 58,
  offsetSm: 18,
  offsetXs: 14,
  floatPeriod: 9.6,
  floatDelay: -4.7,
  floatStops: [
    [0.0, 2, 0.25],
    [0.09, 2, 0.25],
    [0.31, -3, -0.25],
    [0.35, -3, -0.25],
    [0.64, 3, 0.2],
    [0.68, 3, 0.2],
    [0.93, 2, 0.25],
    [1.0, 2, 0.25],
  ],
};

/** Vertical anchor of the side islands, mirroring --island-upper-axis. */
export function upperAxis(widthPx: number) {
  if (widthPx <= 560) return 0.22;
  if (widthPx <= 900) return 0.2;
  return 0.18;
}

/** Mirror of the legacy --island-center-scale per-breakpoint value. */
export function centerScale(widthPx: number) {
  if (widthPx <= 560) return 0.9;
  if (widthPx <= 900) return 0.95;
  return 1;
}

const clamp = (min: number, preferred: number, max: number) =>
  Math.min(Math.max(min, preferred), max);

export function sideIslandWidthPx(spec: SideIslandSpec, widthPx: number) {
  if (widthPx <= 560)
    return clamp(spec.minWidthXs, spec.widthVwXs * widthPx, spec.maxWidthXs);
  if (widthPx <= 900)
    return clamp(spec.minWidthSm, spec.widthVwSm * widthPx, spec.maxWidthSm);
  return clamp(spec.minWidth, spec.widthVw * widthPx, spec.maxWidth);
}

export function sideIslandOffsetPx(spec: SideIslandSpec, widthPx: number) {
  if (widthPx <= 560) return spec.offsetXs;
  if (widthPx <= 900)
    return clamp(spec.offsetSm, spec.offsetVw * widthPx, spec.offsetMax);
  return clamp(spec.offsetMin, spec.offsetVw * widthPx, spec.offsetMax);
}

/**
 * Piecewise interpolation of the old CSS float keyframes, with the same smoothstep ease
 * the centre island's float path uses so all three layers breathe together.
 */
export function islandDrift(spec: SideIslandSpec, time: number) {
  const stops = spec.floatStops;
  const phase = ((((time + spec.floatDelay) / spec.floatPeriod) % 1) + 1) % 1;
  for (let index = 1; index < stops.length; index += 1) {
    const next = stops[index];
    if (phase <= next[0]) {
      const previous = stops[index - 1];
      const span = next[0] - previous[0];
      const segment = span <= 0 ? 1 : (phase - previous[0]) / span;
      const eased = segment * segment * (3 - 2 * segment);
      return {
        offsetY: previous[1] + (next[1] - previous[1]) * eased,
        rotation:
          (previous[2] + (next[2] - previous[2]) * eased) * (Math.PI / 180),
      };
    }
  }
  const last = stops[stops.length - 1];
  return { offsetY: last[1], rotation: last[2] * (Math.PI / 180) };
}

/** Lit / shaded values of the vapour, picked from the cloud tops around the island tips. */
export const MIST_LIT_COLOR = "#e7cadf";
export const MIST_SHADOW_COLOR = "#66659d";

/**
 * A wisp band. Sizes and offsets are multiples of their anchor (an island image box, or the
 * centre island), so a band keeps hugging the same rocks at every breakpoint.
 */
export type MistBand = {
  seed: number;
  /** Peak alpha of the band. */
  opacity: number;
  /** How hard the ridge is crushed: bigger leaves fewer, thinner filaments. */
  thinness: number;
  /** How much the eroded detail eats into the edges. */
  erosion: number;
  drift: number;
  yBias: number;
  frequency: readonly [number, number];
  widthFactor: number;
  heightFactor: number;
  offsetX: number;
  offsetY: number;
  /** Share of the island's own bob that the band inherits. */
  follow: number;
};

/** The band that overlaps each side island's lower tip. */
export const ISLAND_MIST: MistBand = {
  seed: 3.7,
  opacity: 0.68,
  thinness: 2.6,
  erosion: 0.88,
  drift: 0.013,
  yBias: 0.1,
  frequency: [3.1, 5.4],
  widthFactor: 2.3,
  heightFactor: 0.6,
  offsetX: 0,
  offsetY: -0.1,
  follow: 0.6,
};

/** Second band, retuned so the two sides never drift in lockstep or share a silhouette. */
export const ISLAND_MIST_ALT: MistBand = {
  ...ISLAND_MIST,
  seed: 12.9,
  opacity: 0.58,
  thinness: 2.9,
  erosion: 0.92,
  drift: 0.017,
  yBias: 0.08,
  frequency: [2.9, 4.8],
  offsetY: -0.08,
};

/** Wisps in front of the centre island: nearest layer, so they read the softest. */
export const CENTRE_MIST: Array<
  MistBand & { anchorX: number; anchorY: number }
> = [
  {
    ...ISLAND_MIST,
    seed: 71.3,
    opacity: 0.5,
    thinness: 2.9,
    erosion: 0.92,
    drift: 0.017,
    yBias: 0.1,
    frequency: [2.9, 4.8],
    widthFactor: 1.6,
    heightFactor: 0.26,
    offsetY: 0,
    follow: 0,
    anchorX: 0.48,
    anchorY: 0.415,
  },
  {
    ...ISLAND_MIST,
    seed: 27.9,
    opacity: 0.42,
    thinness: 2.8,
    erosion: 0.92,
    drift: 0.021,
    yBias: 0.04,
    frequency: [3.1, 5.4],
    widthFactor: 1.1,
    heightFactor: 0.16,
    offsetY: 0,
    follow: 0,
    anchorX: 0.69,
    anchorY: 0.16,
  },
];
