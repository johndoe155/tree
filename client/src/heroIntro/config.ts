/**
 * Every tunable for the hero intro lives here — scroll length, camera start/end
 * transforms, threshold, easing, glow and flash timing — so the choreography can
 * be re-timed without reading the animation code.
 *
 * The camera/model numbers below are measured, not guessed:
 *   - `camera.start` is the live establishing shot from CloudscapeModel's
 *     `<Canvas camera={{ position: [0, 0.15, 5.8] }}>` + `lookAt(0, 0, 0)`.
 *   - the cottage's front wall plane was probed in-scene (raycast from the live
 *     camera through the door and round-window pixels). Its outward normal sits
 *     at yaw -16.7°, i.e. the cottage rests turned 16.7° to the left of the
 *     camera, and the door centre lands at world (-0.166, 0.337, 0.284).
 *   - `camera.end` is that door centre after the model squares up (rotating the
 *     model +16.7° about its centre moves the door to (-0.077, 0.337, 0.320)),
 *     pushed back along the wall normal and nudged slightly right/up so the
 *     shot is framed, not perfectly axial.
 */
import { easeInOutCubic, type EasingFn } from "./easing";

export type Vec3 = readonly [number, number, number];

/** `?introSpeed=0.05` slows the one-shot timeline 20x for frame-by-frame review. */
function readSpeedOverride(fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = new URLSearchParams(window.location.search).get("introSpeed");
    if (raw === null) return fallback;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export type CameraState = {
  /** Camera position in world units (the R3F canvas is 1 unit = 1 three.js unit). */
  position: Vec3;
  /** Point the camera looks at, interpolated in step with `position`. */
  lookAt: Vec3;
};

export type IntroConfig = {
  scroll: {
    /** Extra scroll length (viewport heights) that maps to progress 0 → 1. */
    distanceVh: number;
    /** Progress that arms the one-shot glow → flash → transition timeline. */
    threshold: number;
    /** Per-60fps-frame damping for the smoothed progress (spec's 0.08 feel). */
    damping: number;
    /** Damping used under `prefers-reduced-motion` (snappier, still smooth). */
    reducedMotionDamping: number;
    /**
     * Smallest scrub range (px) that counts as a real range. Below this
     * (reduced motion, failed load) progress stays parked at 0, so the page is
     * a plain scroll rather than a near-zero-range scrub.
     */
    minScrubRangePx: number;
  };
  camera: {
    start: CameraState;
    end: CameraState;
    /**
     * Multiplier applied to the responsive base fov at progress 1. Applied
     * relative to the live fov so the mobile fov (38) stays mobile-friendly.
     */
    endFovScale: number;
    /** Below this progress the look-at target is left alone (free-ish framing). */
    lookAtDeadZone: number;
  };
  model: {
    /**
     * The GLB primitive's authored resting yaw (MODEL_ROTATION_Y in
     * CloudscapeModel). The model is intentionally parked off-front.
     */
    restYawDeg: number;
    /**
     * Extra yaw applied to the model wrapper during the intro: 0 → squared up.
     * Front-facing is therefore restYawDeg + squaredYawDeg = -73.3°, which is
     * what actually squares the facade to the camera in this scene (measured
     * from the wall-plane normal, not assumed to be 0 in the GLB's own space).
     */
    squaredYawDeg: number;
  };
  glow: {
    /** Warm door-light colour for the emissive planes and point light. */
    color: string;
    /** Hotter core colour, used for the window pane itself. */
    coreColor: string;
    /** Emissive plane scale (world units, float-group space) for the halo. */
    haloSize: number;
    /** Emissive plane scale for the round window core. */
    coreSize: number;
    /** Emissive plane scale for the light spilling from the doorway. */
    doorSize: number;
    /** Peak multiplier applied to the halo material colour. */
    haloIntensity: number;
    /** Peak intensity of the point light placed at the door. */
    lightIntensity: number;
    /** Point-light falloff distance (world units). */
    lightDistance: number;
    /** How much the halo grows while the white flash expands. */
    bloomGrowth: number;
  };
  flash: {
    colour: string;
    /** ms: door light ramps up. */
    glowMs: number;
    /** ms: white expands from the door's screen position to cover the viewport. */
    expandMs: number;
    /** ms: held fully opaque before the reveal happens. */
    holdMs: number;
    /** ms: overlay fades out over the revealed content. */
    fadeOutMs: number;
    /** Timeline multiplier under `prefers-reduced-motion`. */
    reducedMotionScale: number;
    /**
     * Dev/tuning multiplier for the whole one-shot timeline (1 = real time).
     * Overridable with `?introSpeed=<n>` — the same URL-flag convention the
     * atmosphere stack uses — so the flash can be inspected frame by frame.
     */
    speed: number;
    /** Bloom radius floor, in vmin, for the very first flash frame. */
    minRadiusVmin: number;
  };
  reveal: {
    /** Element the sequence hands off to (SiteContent uses this id). */
    selector: string;
  };
  loading: {
    /**
     * How long to wait for the GLB before surfacing an explicit "skip intro"
     * control (ms). Generous by default: the asset is a 47 MB meshopt GLB and
     * the fallback only adds an escape hatch — the sequence still becomes
     * scrubbable the moment the model arrives.
     */
    timeoutMs: number;
  };
  /** Easing applied to progress before it drives the camera. Swappable. */
  easing: EasingFn;
  /** Easing used for the within-timeline (time-based) ramps. */
  timelineEasing: EasingFn;
};

export const INTRO: IntroConfig = {
  scroll: {
    distanceVh: 3.2,
    threshold: 0.9,
    damping: 0.08,
    reducedMotionDamping: 0.2,
    minScrubRangePx: 8,
  },
  camera: {
    start: { position: [0, 0.15, 5.8], lookAt: [0, 0, 0] },
    end: { position: [-0.018, 0.452, 1.92], lookAt: [-0.062, 0.432, 0.33] },
    endFovScale: 0.9,
    lookAtDeadZone: 0,
  },
  model: {
    restYawDeg: -90,
    squaredYawDeg: 16.7,
  },
  glow: {
    color: "#ffcf95",
    coreColor: "#fff4dc",
    haloSize: 0.3,
    coreSize: 0.115,
    doorSize: 0.105,
    haloIntensity: 1.15,
    lightIntensity: 1.6,
    lightDistance: 1.1,
    bloomGrowth: 3.4,
  },
  flash: {
    colour: "#ffffff",
    glowMs: 420,
    expandMs: 480,
    holdMs: 90,
    fadeOutMs: 620,
    reducedMotionScale: 0.35,
    speed: readSpeedOverride(1),
    minRadiusVmin: 8,
  },
  reveal: {
    selector: "#site-content",
  },
  loading: {
    timeoutMs: 20000,
  },
  easing: easeInOutCubic,
  timelineEasing: easeInOutCubic,
};

/** Anchor points inside the model (float-group space), from the live GLB. */
export const MODEL_ANCHORS = {
  /** Round window pane above the door (measured on the live model). */
  window: [-0.0605, 0.2187, 0.121] as Vec3,
  /** Door slab centre. */
  door: [-0.064, 0.13, 0.1096] as Vec3,
  /** Wall plane through the door/window, as `z = base + slope * x` (pre-rotation). */
  wall: { base: 0.1288, slope: 0.2996 },
  /** Points from the wall towards the camera, in model space. */
  wallNormal: [-0.287, 0, 0.958] as Vec3,
};

/**
 * How far back each 2D layer sits, in world units along the camera's view axis.
 * The layers are DOM elements, but they are positioned by projecting them
 * through the same camera that drives the GLB, so the whole scenery shares one
 * perspective instead of the 3D model moving inside a frozen picture:
 *
 *   - the flanking islands share the cottage's own plane (z = 0), so they grow
 *     with it and are clipped out of frame as the camera pushes in;
 *   - the cloudscape sits far behind (z = -30), so it barely grows and is only
 *     panned by the camera's rotation — that near/far differential is the cue
 *     that reads as real distance.
 *
 * Each layer's on-screen size and position at progress 0 are used to solve its
 * world anchor and world height, so the layout is unchanged when the intro is
 * at rest (responsive breakpoints included).
 */
export type BackdropId = "tree" | "statue" | "background";

export type BackdropSpec = {
  /** World z plane this layer is treated as living on. */
  worldZ: number;
  /**
   * True for layers that must always keep covering the viewport (the sky):
   * their scale is raised as needed so panning can never expose an edge.
   */
  coversViewport: boolean;
  note: string;
};

export const BACKDROPS: Record<BackdropId, BackdropSpec> = {
  tree: { worldZ: 0, coversViewport: false, note: "flanking island, cottage plane" },
  statue: { worldZ: 0, coversViewport: false, note: "flanking island, cottage plane" },
  background: { worldZ: -30, coversViewport: true, note: "sky / cloud sea, far plane" },
};

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
