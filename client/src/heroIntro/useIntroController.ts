/**
 * The intro state machine.
 *
 *   idle ──(progress ≥ threshold, once)──▶ triggered ──▶ flashing ──▶ transitioning ──▶ done
 *
 * `triggered`    : the door light ramps up (time-based, not scroll-based).
 * `flashing`     : the white expands from the door's screen position and holds.
 * `transitioning`: the hero (canvas included) is unmounted, the real content is
 *                  snapped into place underneath the full-white overlay, and the
 *                  overlay fades out over it.
 * `done`         : nothing else can re-arm the sequence this session.
 *
 * The timeline runs on a `requestAnimationFrame` clock — deliberately not on
 * scroll and not on React state — so a fast scroll-flick cannot break it and
 * scrolling back cannot reverse it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { INTRO, REDUCED_MOTION_QUERY } from "./config";
import { clamp01, easeOutCubic } from "./easing";
import type { IntroHandle, IntroPhase } from "./introHandle";

export type IntroController = {
  phase: IntroPhase;
  /** True while the hero subtree (and its WebGL canvas) should stay mounted. */
  heroMounted: boolean;
  /** True once the GLB has rendered a frame. */
  sceneReady: boolean;
  /** True when the scene could not be prepared — the sequence is bypassed. */
  loadTimedOut: boolean;
  /** Overlay node, driven directly from the timeline (no re-render per frame). */
  overlayRef: React.RefObject<HTMLDivElement | null>;
  /** Track the sticky hero is pinned inside. */
  trackRef: React.RefObject<HTMLDivElement | null>;
  /** Height of the pinned scroll range, in svh. */
  trackHeightVh: number;
  /** Runs the sequence now — reduced-motion control / skip button. */
  start: () => void;
  /** Drops straight to the content (used when the scene never becomes ready). */
  skipToContent: () => void;
  /** True when the user asked for reduced motion. */
  reducedMotion: boolean;
};

export function useIntroController(handle: IntroHandle): IntroController {
  const [phase, setPhase] = useState<IntroPhase>("idle");
  const [heroMounted, setHeroMounted] = useState(true);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const reducedMotion = useReducedMotion();

  // Mirrors `phase` for listeners/timers that must not depend on React state.
  const runningRef = useRef(false);
  const committedRef = useRef(false);
  const revealPendingRef = useRef(false);
  const rafRef = useRef(0);
  const startedAtRef = useRef(0);

  /** Timeline lengths, shortened when the user asked for reduced motion. */
  const timings = useMemo(() => {
    const scale = reducedMotion ? INTRO.flash.reducedMotionScale : 1;
    const speed = INTRO.flash.speed;
    return {
      glow: (INTRO.flash.glowMs * scale) / speed,
      expand: (INTRO.flash.expandMs * scale) / speed,
      hold: (INTRO.flash.holdMs * scale) / speed,
      fade: (INTRO.flash.fadeOutMs * (reducedMotion ? 0.7 : 1)) / speed,
    };
  }, [reducedMotion]);

  // ---------------------------------------------------------------------
  // Scroll progress: sampled from the pinned track, never read raw in a loop.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const read = () => {
      // Once the timeline owns the frame the camera target is pinned to 1, so
      // there is nothing to update here — and no way to reverse the sequence.
      if (handle.locked.current) return;
      const rect = track.getBoundingClientRect();
      const distance = Math.max(1, rect.height - window.innerHeight);
      const progress = clamp01(-rect.top / distance);
      handle.scrollProgress.current = progress;
      // Keep the fixed flanking islands from colliding with the tight shot.
      // Cheap (one custom-property write per scroll tick) and smoothed in CSS.
      const { start, end } = INTRO.scroll.backdropFade;
      const fade = 1 - clamp01((progress - start) / Math.max(1e-4, end - start));
      track.style.setProperty("--hero-backdrop-fade", fade.toFixed(3));
    };

    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    observer?.observe(track);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
      observer?.disconnect();
    };
  }, [handle]);

  // ---------------------------------------------------------------------
  // Loading gate: the sequence must not be scrubbable before the GLB is up.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (sceneReady) return;
    const timeout = window.setTimeout(() => {
      // The ref is set synchronously by the scene, so it is the race-free
      // source of truth: a timer that expired while the main thread was busy
      // decoding the GLB must not win after the scene has reported ready.
      if (handle.ready.current) return;
      setLoadTimedOut(true);
    }, INTRO.loading.timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [sceneReady, handle]);

  const loadingLock = !sceneReady && !loadTimedOut;

  // Scene components inside the canvas read this off the handle.
  useEffect(() => {
    handle.reducedMotion.current = reducedMotion;
  }, [handle, reducedMotion]);

  // ---------------------------------------------------------------------
  // Scroll lock: freeze the page (never the timeline) while the sequence runs.
  // ---------------------------------------------------------------------
  const scrollLocked =
    loadingLock || phase === "triggered" || phase === "flashing" || phase === "transitioning";
  useEffect(() => {
    if (!scrollLocked) return;
    const root = document.documentElement;
    root.classList.add("hero-intro-locked");
    const swallow = (event: Event) => event.preventDefault();
    const swallowKeys = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
        event.preventDefault();
      }
    };
    window.addEventListener("wheel", swallow, { passive: false });
    window.addEventListener("touchmove", swallow, { passive: false });
    window.addEventListener("keydown", swallowKeys);
    return () => {
      root.classList.remove("hero-intro-locked");
      window.removeEventListener("wheel", swallow);
      window.removeEventListener("touchmove", swallow);
      window.removeEventListener("keydown", swallowKeys);
    };
  }, [scrollLocked]);

  /** Write the overlay's animated custom properties (no React re-render). */
  const paintOverlay = useCallback((radiusPx: number, wash: number, opacity: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.setProperty("--flash-radius", `${radiusPx.toFixed(1)}px`);
    overlay.style.setProperty("--flash-wash", wash.toFixed(4));
    overlay.style.opacity = opacity.toFixed(4);
  }, []);

  const commitTransition = useCallback(() => {
    // Called the moment the overlay is fully opaque: swap the hero for the real
    // content underneath it, so the fade-out below reveals the destination
    // rather than a layout jump.
    handle.phase.current = "transitioning";
    setPhase("transitioning");
    revealPendingRef.current = true;
    setHeroMounted(false);
  }, [handle]);

  const finish = useCallback(() => {
    runningRef.current = false;
    handle.flashLevel.current = 1;
    handle.glowLevel.current = 1;
    handle.phase.current = "done";
    setPhase("done");
  }, [handle]);

  const step = useCallback(
    (now: number) => {
      const elapsed = now - startedAtRef.current;
      const { glow, expand, hold, fade } = timings;
      const revealAt = glow + expand;
      const fadeStart = revealAt + hold;
      const endAt = fadeStart + fade;

      // Stage `triggered` → door light ramps up; the flash is still closed.
      // Stage `flashing`  → white expands from the door, then holds at full.
      const expandT = easeOutCubic(clamp01((elapsed - glow) / expand));
      handle.glowLevel.current = elapsed <= glow ? easeOutCubic(clamp01(elapsed / glow)) : 1;
      handle.flashLevel.current = clamp01((elapsed - glow) / expand);

      const radius = overlayRadius(overlayRef.current, expandT);
      // The flat wash catches up in the back half of the expansion, so the last
      // thing the eye reads is light from the door swallowing the viewport.
      const wash = clamp01((expandT - 0.45) / 0.55);
      const opacity = elapsed >= fadeStart ? 1 - clamp01((elapsed - fadeStart) / fade) : 1;
      paintOverlay(radius, wash, opacity);

      if (!committedRef.current && elapsed >= revealAt) {
        committedRef.current = true;
        commitTransition();
      }

      if (elapsed >= endAt) {
        finish();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    },
    [timings, handle, overlayRef, paintOverlay, commitTransition, finish]
  );

  const start = useCallback(() => {
    // Guard: one shot per session. Scrolling back and forth across the
    // threshold can never re-arm it.
    if (runningRef.current || handle.phase.current !== "idle") return;
    runningRef.current = true;
    handle.phase.current = "triggered";
    handle.locked.current = true; // scroll input is ignored from here on
    setPhase("triggered");

    // Seed the overlay at the door's current screen position so the flash
    // originates where the light actually is.
    const door = handle.doorScreen.current;
    const overlay = overlayRef.current;
    overlay?.style.setProperty("--flash-x", `${((door.visible ? door.x : 0.5) * 100).toFixed(3)}%`);
    overlay?.style.setProperty("--flash-y", `${((door.visible ? door.y : 0.5) * 100).toFixed(3)}%`);
    paintOverlay(0, 0, 1);

    startedAtRef.current = performance.now();
    rafRef.current = requestAnimationFrame(step);
  }, [handle, paintOverlay, step]);

  const skipToContent = useCallback(() => {
    if (handle.phase.current === "done" || handle.phase.current === "transitioning") return;
    runningRef.current = true;
    handle.locked.current = true;
    paintOverlay(0, 0, 0);
    commitTransition();
    finish();
  }, [handle, paintOverlay, commitTransition, finish]);

  // Scene → controller wiring.
  useEffect(() => {
    handle.reportReady = () => {
      handle.ready.current = true;
      setSceneReady(true);
      setLoadTimedOut(false);
    };
    handle.fireThreshold = () => start();
    return () => {
      handle.reportReady = () => {};
      handle.fireThreshold = () => {};
    };
  }, [handle, start]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // The overlay's origin needs a mounted node before the first frame paints.
  useLayoutEffect(() => {
    if (phase !== "triggered") return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const door = handle.doorScreen.current;
    overlay.style.setProperty("--flash-x", `${((door.visible ? door.x : 0.5) * 100).toFixed(3)}%`);
    overlay.style.setProperty("--flash-y", `${((door.visible ? door.y : 0.5) * 100).toFixed(3)}%`);
  }, [phase, handle]);

  // Once the hero is gone the content sits at the top of the document; snap
  // there while the overlay is still opaque (layout effect ⇒ before paint).
  useLayoutEffect(() => {
    if (heroMounted || !revealPendingRef.current) return;
    revealPendingRef.current = false;
    const target = INTRO.reveal.selector ? document.querySelector(INTRO.reveal.selector) : null;
    const top = target ? target.getBoundingClientRect().top + window.scrollY : 0;
    window.scrollTo({ top, behavior: "auto" });
  }, [heroMounted]);

  const trackHeightVh = useMemo(() => {
    // Reduced motion (or a scene that never arrived) keeps a single viewport:
    // there is no scrub range to get lost in.
    if (reducedMotion || loadTimedOut) return 100;
    return 100 + INTRO.scroll.distanceVh * 100;
  }, [reducedMotion, loadTimedOut]);

  return {
    phase,
    heroMounted,
    sceneReady,
    loadTimedOut,
    overlayRef,
    trackRef,
    trackHeightVh,
    start,
    skipToContent,
    reducedMotion,
  };
}

/**
 * Radius the expanding white needs to clear the far corner of the viewport from
 * the door's screen position. Uses the live viewport size (the overlay is
 * `position: fixed; inset: 0`) so a resize mid-flash cannot leave a corner
 * uncovered.
 */
function overlayRadius(overlay: HTMLElement | null, t: number): number {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const x = ((parseFloat(overlay?.style.getPropertyValue("--flash-x") || "50") || 50) / 100) * width;
  const y = ((parseFloat(overlay?.style.getPropertyValue("--flash-y") || "50") || 50) / 100) * height;
  const furthest = Math.max(
    Math.hypot(x, y),
    Math.hypot(width - x, y),
    Math.hypot(x, height - y),
    Math.hypot(width - x, height - y)
  );
  const floor = (INTRO.flash.minRadiusVmin / 100) * Math.min(width, height);
  return floor + (furthest * 1.05 - floor) * t;
}

export const INTRO_FLASH_ID = "hero-intro-flash";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
