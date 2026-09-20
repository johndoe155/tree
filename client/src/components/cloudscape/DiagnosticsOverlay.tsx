import { useEffect, useState } from "react";
import { readDiag, readDiagSummary, subscribeDiag } from "./diagnostics";

const DEV = import.meta.env.DEV;

/**
 * Dev-only. The scene runs in exactly one place - a browser - and this project's failure mode was a
 * canvas that looked like a loading state while the reason sat in a console nobody had open. The
 * overlay puts the render loop's own numbers on screen (and the same lines are posted to the dev
 * server, which appends them to `.manus-logs/cloudscape-diag.log`), so the answer is readable without
 * opening devtools at all.
 */
export default function DiagnosticsOverlay() {
  const [, refresh] = useState(0);

  useEffect(() => {
    if (!DEV) return;
    let frame = 0;
    const unsubscribe = subscribeDiag(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh(value => value + 1);
      });
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  if (!DEV) return null;

  const lines = readDiag()
    .slice(-7)
    .map(entry => `${String(entry.t).padStart(6)}ms  ${entry.msg}`)
    .join("\n");

  return (
    <pre
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 8,
        bottom: 8,
        zIndex: 3,
        margin: 0,
        padding: "7px 9px",
        maxWidth: "min(86ch, 94vw)",
        font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#ecdcff",
        background: "rgba(10, 6, 26, 0.74)",
        border: "1px solid rgba(236, 220, 255, 0.16)",
        borderRadius: 6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        pointerEvents: "none",
      }}
    >
      {`cloudscape · ${readDiagSummary()}`}
      {lines ? `\n${lines}` : ""}
    </pre>
  );
}
