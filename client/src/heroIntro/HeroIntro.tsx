/**
 * The hero's scroll-driven intro.
 *
 * Layout: a tall "track" whose sticky child holds the hero for the whole scrub
 * range. The wrapper owns the three concerns and keeps them separate —
 * the controller (state machine), the overlay (flash), and the scene (camera
 * rig + door glow, mounted inside CloudscapeModel via context/props).
 */
import { useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { INTRO } from "./config";
import { HeroIntroContext } from "./context";
import { createIntroHandle } from "./introHandle";
import { INTRO_FLASH_ID, useIntroController } from "./useIntroController";
import SiteContent from "./SiteContent";
import "./heroIntro.css";

export default function HeroIntro({ children }: { children: ReactNode }) {
  // One handle for the lifetime of the page: the scene and the timeline both
  // hold on to it, so replacing it would break the shared per-frame state.
  const handleRef = useRef<ReturnType<typeof createIntroHandle>>(null);
  if (!handleRef.current) handleRef.current = createIntroHandle();
  const handle = handleRef.current;

  const {
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
  } = useIntroController(handle);

  // The manual affordance appears whenever the scrub path is not available:
  // reduced motion, a failed/slow load, or an explicit opt-out.
  const showControl = reducedMotion || loadTimedOut || !sceneReady;

  const flashStyle = useMemo(
    () =>
      ({
        "--intro-flash-colour": INTRO.flash.colour,
      }) as React.CSSProperties,
    []
  );

  return (
    <HeroIntroContext.Provider value={handle}>
      <div className="hero-intro" data-phase={phase}>
        {heroMounted && (
          <div className="hero-intro__track" ref={trackRef} style={{ height: `${trackHeightVh}svh` }}>
            <div className="hero-intro__pin">
              {children}

              <div className="hero-intro__loader" data-visible={!sceneReady && !loadTimedOut}>
                <span className="hero-intro__loader-dot" />
                <span className="hero-intro__loader-text">Waking the cottage…</span>
              </div>

              {showControl && (
                <button
                  type="button"
                  className="hero-intro__control"
                  onClick={() => (sceneReady ? start() : skipToContent())}
                >
                  {sceneReady ? "Enter" : "Skip intro"}
                </button>
              )}
            </div>
          </div>
        )}

        <SiteContent />
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <div
            id={INTRO_FLASH_ID}
            className="hero-intro__flash"
            style={flashStyle}
            ref={overlayRef}
            aria-hidden="true"
          >
            <div className="hero-intro__flash-bloom" />
            <div className="hero-intro__flash-wash" />
          </div>,
          document.body
        )}
    </HeroIntroContext.Provider>
  );
}
