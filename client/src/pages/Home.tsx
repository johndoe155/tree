import { useCallback, useEffect, useRef, useState } from "react";
import CloudscapeScene from "@/components/cloudscape/CloudscapeScene";
import DiagnosticsOverlay from "@/components/cloudscape/DiagnosticsOverlay";
import { installDiagTaps, logDiag } from "@/components/cloudscape/diagnostics";

const PHOTO_URL = "/cloudscape-source.webp";
const ISLAND_SOURCES = [
  {
    key: "tree",
    className: "cloudscape__fallback-island cloudscape__fallback-island--tree",
    src: "/tree-island.png",
  },
  {
    key: "statue",
    className:
      "cloudscape__fallback-island cloudscape__fallback-island--statue",
    src: "/statue-island.png",
  },
];

function hasWebGL2() {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    return probe.getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

/**
 * The whole view is one canvas: the cloudscape plate, the two PNG islands, the centre island and the
 * post-process that finishes them all together. This page owns the still photograph underneath it and
 * keeps it up until the canvas has actually painted a frame - never a rAF, never a Suspense boundary,
 * so a slow or stalled asset can only ever delay the reveal, never replace the picture with a blank.
 */
export default function Home() {
  const [supported] = useState(hasWebGL2);
  const [painted, setPainted] = useState(false);
  const [lost, setLost] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const handlePainted = useCallback(() => setPainted(true), []);

  useEffect(
    () => installDiagTaps(() => sceneRef.current?.querySelector("canvas")),
    []
  );

  // A lost context hands the picture back to the photograph; three re-uploads its own textures on
  // restore, and the reveal gate above does the rest.
  useEffect(() => {
    if (!supported) return;
    const canvas = sceneRef.current?.querySelector("canvas");
    if (!canvas) return;
    const onLost = (event: Event) => {
      event.preventDefault();
      setLost(true);
    };
    const onRestored = () => setLost(false);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [supported, painted]);

  const showFallback = !supported || !painted || lost;

  useEffect(() => {
    logDiag(showFallback ? "showing photograph" : "showing canvas");
  }, [showFallback]);

  return (
    <main className="cloudscape" aria-label="Animated cloudscape">
      {supported ? (
        <div ref={sceneRef} className="cloudscape__scene">
          <CloudscapeScene ready={!showFallback} onReady={handlePainted} />
        </div>
      ) : null}
      <div
        className={`cloudscape__fallback-stack${showFallback ? " is-visible" : ""}`}
        aria-hidden="true"
      >
        <img className="cloudscape__fallback" src={PHOTO_URL} alt="" />
        {ISLAND_SOURCES.map(island => (
          <img
            key={island.key}
            className={island.className}
            src={island.src}
            alt=""
          />
        ))}
      </div>
      <DiagnosticsOverlay />
    </main>
  );
}
