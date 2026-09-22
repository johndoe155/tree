/**
 * The shared state object that connects the three concerns:
 *
 *   HeroIntro (controller)  ──┐
 *   IntroCameraRig (scene)  ──┼── IntroHandle ── DoorGlow (scene)
 *   FlashOverlay (DOM)      ──┘
 *
 * Everything per-frame lives behind plain `{ current }` cells so the render
 * loop never has to touch React state (no re-renders, no allocations).
 * React state is reserved for the four coarse phase changes.
 */

export type IntroPhase = "idle" | "triggered" | "flashing" | "transitioning" | "done";

/** A mutable cell. Deliberately not `RefObject` so plain objects can use it too. */
export type Cell<T> = { current: T };

export type DoorScreenPosition = {
  /** Viewport fractions, 0..1 (top-left origin) — matches CSS/DOM coordinates. */
  x: number;
  y: number;
  /** False when the door is off-screen or behind the camera. */
  visible: boolean;
};

export type IntroHandle = {
  /** Raw scroll progress 0..1 across the pinned range (written by the scroll listener). */
  scrollProgress: Cell<number>;
  /** Damped progress 0..1 (written by the render loop, read by the camera rig). */
  smoothProgress: Cell<number>;
  /** 0..1 door-light level (written by the flash timeline). */
  glowLevel: Cell<number>;
  /** 0..1 white-flash expansion (written by the flash timeline). */
  flashLevel: Cell<number>;
  /** Viewport fractions of the door, used as the flash origin (written by the scene). */
  doorScreen: Cell<DoorScreenPosition>;
  /** State machine phase, mirrored for ref-only readers. */
  phase: Cell<IntroPhase>;
  /** True once the GLB has rendered a frame — the sequence cannot start before this. */
  ready: Cell<boolean>;
  /** Length of the pinned scroll range in px (recomputed on resize). */
  scrollDistance: Cell<number>;
  /** True once the timeline owns the frame: the camera stops listening to scroll. */
  locked: Cell<boolean>;
  /** Mirrors `prefers-reduced-motion` for scene components inside the canvas. */
  reducedMotion: Cell<boolean>;
  /** Scene → controller: model is mounted, enough to scrub. */
  reportReady: () => void;
  /** Scene → controller: progress crossed the threshold; start the one-shot timeline. */
  fireThreshold: () => void;
};

export function createIntroHandle(): IntroHandle {
  return {
    scrollProgress: { current: 0 },
    smoothProgress: { current: 0 },
    glowLevel: { current: 0 },
    flashLevel: { current: 0 },
    doorScreen: { current: { x: 0.5, y: 0.5, visible: false } },
    phase: { current: "idle" },
    ready: { current: false },
    scrollDistance: { current: 1 },
    locked: { current: false },
    reducedMotion: { current: false },
    reportReady: () => {},
    fireThreshold: () => {},
  };
}
