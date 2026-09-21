/** Live layout of the flanking island <img>s so overlay shaders can hug them.
 *  Reads computed CSS transforms (float animation included). Never mutates the imgs. */

export type IslandMeasure = {
  /** NDC-ish 0-1 box of the element (x, y from top-left of viewport). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** CSS matrix 2d: a c tx / b d ty as [a, b, c, d, tx, ty] in CSS pixels. */
  m: [number, number, number, number, number, number];
};

export type SceneMeasure = {
  tree: IslandMeasure | null;
  statue: IslandMeasure | null;
  viewport: { w: number; h: number };
};

function parseMatrix(transform: string): [number, number, number, number, number, number] {
  if (!transform || transform === "none") return [1, 0, 0, 1, 0, 0];
  const m3 = transform.match(/^matrix3d\((.+)\)$/);
  if (m3) {
    const n = m3[1].split(",").map((s) => parseFloat(s.trim()));
    // matrix3d: m11 m12 m13 m14 m21 m22 m23 m24 m31 m32 m33 m34 m41 m42 m43 m44
    return [n[0], n[1], n[4], n[5], n[12], n[13]];
  }
  const m2 = transform.match(/^matrix\((.+)\)$/);
  if (m2) {
    const n = m2[1].split(",").map((s) => parseFloat(s.trim()));
    return [n[0], n[1], n[2], n[3], n[4], n[5]];
  }
  return [1, 0, 0, 1, 0, 0];
}

function measureEl(el: Element | null): IslandMeasure | null {
  if (!el) return null;
  const r = (el as HTMLElement).getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
    m: parseMatrix(cs.transform),
  };
}

export function measureScene(): SceneMeasure {
  return {
    tree: measureEl(document.querySelector(".cloudscape__island--tree")),
    statue: measureEl(document.querySelector(".cloudscape__island--statue")),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
}

/** Pack island layout into 6 floats for a shader uniform (xywh in 0-1 uv + unused). */
export function islandToUv(m: IslandMeasure | null, vw: number, vh: number): [number, number, number, number] {
  if (!m || vw < 1 || vh < 1) return [0, 0, 0, 0];
  return [m.x / vw, m.y / vh, m.w / vw, m.h / vh];
}
