import { useCallback, useEffect, useRef, useState } from "react";
import CloudscapeScene from "@/components/cloudscape/CloudscapeScene";

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
 * The whole view is one canvas: the cloudscape plate, the two PNG islands, the centre island and
 * the post-process that finishes them all together. This page only owns the still-image fallback
 * around it, and keeps it up until the first real frame is on screen so nothing ever pops in.
 */
export default function Home() {
  const [supported] = useState(hasWebGL2);
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const handleReady = useCallback(() => setReady(true), []);

  // A lost context used to blank the background plate and leave a stale framebuffer behind. Here
  // the fallback simply takes over again, and three re-uploads its own textures on restore.
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
  }, [supported, ready]);

  const showFallback = !supported || !ready || lost;

  return (
    <main className="cloudscape" aria-label="Animated cloudscape">
      {supported ? (
        <div ref={sceneRef} className="cloudscape__scene">
          <CloudscapeScene ready={!showFallback} onReady={handleReady} />
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
    </main>
  );
}
