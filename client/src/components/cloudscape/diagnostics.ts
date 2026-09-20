/**
 * A tiny diagnostics channel, meant for the one problem this project had that could not be observed
 * from the editor: the browser is the only place the WebGL scene actually runs.
 *
 * Everything worth knowing is pushed into a ring buffer that (a) the dev overlay renders, and (b) in
 * development is posted to the dev server, which appends it to `.manus-logs/cloudscape-diag.log`.
 * That second half means a report can be read back from the workspace after a reload, without anyone
 * having to open devtools.
 */
export type DiagEntry = { t: number; msg: string };

const ring: DiagEntry[] = [];
const listeners = new Set<() => void>();
const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
let tapsInstalled = false;
let queue: string[] = [];
let flushTimer = 0;
const DEV = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

function notify() {
  listeners.forEach(listener => listener());
}

export function logDiag(message: string) {
  const entry = { t: Math.round(performance.now() - startedAt), msg: message };
  ring.push(entry);
  if (ring.length > 120) ring.splice(0, ring.length - 120);
  notify();
  if (DEV) {
    queue.push(`${entry.t}ms ${message}`);
    if (!flushTimer) flushTimer = window.setTimeout(flush, 800);
  }
  if (typeof console !== "undefined") console.info(`[cloudscape] ${message}`);
}

function flush() {
  flushTimer = 0;
  if (!queue.length) return;
  const payload = queue.join("\n");
  queue = [];
  fetch("/__cloudscape-diag", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: payload,
  }).catch(() => {
    /* the dev server may not have the plugin; the overlay still shows everything */
  });
}

export function readDiag(): DiagEntry[] {
  return ring.slice();
}

/** Per-layer progress, reported by whoever loads it, so the overlay needs no prop plumbing. */
const layers = new Map<string, string>();
export function setDiagLayer(name: string, stage: string) {
  if (layers.get(name) === stage) return;
  layers.set(name, stage);
  notify();
}
export function readDiagLayers() {
  if (!layers.size) return "no layers reported";
  const parts: string[] = [];
  layers.forEach((stage, name) => parts.push(`${name}:${stage}`));
  return parts.join(" ");
}

/** The live one-line summary of the scene, kept by the render loop for the overlay. */
let summary = "starting";
export function setDiagSummary(value: string) {
  if (value === summary) return;
  summary = value;
  notify();
}
export function readDiagSummary() {
  return summary;
}

export function subscribeDiag(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Captures the things that otherwise only appear in a console nobody has open: three's shader and
 * program warnings, uncaught errors, rejected loader promises, and WebGL context loss.
 */
export function installDiagTaps(
  canvasGetter?: () => HTMLCanvasElement | null | undefined
) {
  if (tapsInstalled || typeof window === "undefined") return;
  tapsInstalled = true;

  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const text = args
        .map(arg =>
          arg instanceof Error
            ? arg.message
            : typeof arg === "string"
              ? arg
              : ""
        )
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 400);
      if (/three|webgl|shader|program|gltf|texture|meshopt/i.test(text)) {
        logDiag(`console.${level}: ${text}`);
      }
      original(...args);
    };
  }

  window.addEventListener("error", event => {
    logDiag(
      `window.error: ${event.message} @${event.filename?.split("/").pop() ?? "?"}:${event.lineno}`
    );
  });
  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    logDiag(
      `unhandledrejection: ${reason instanceof Error ? reason.message : String(reason)}`
    );
  });

  const attach = () => {
    const canvas = canvasGetter?.();
    if (!canvas) return;
    canvas.addEventListener(
      "webglcontextlost",
      () => logDiag("webgl context LOST"),
      {
        once: false,
      }
    );
    canvas.addEventListener("webglcontextrestored", () =>
      logDiag("webgl context restored")
    );
  };
  if (document.readyState === "complete") attach();
  else window.addEventListener("load", attach, { once: true });
}
