import { useEffect, useRef } from "react";
import { ATMO, INTENSITY, REDUCED_MOTION } from "./config";
import { createProgram, loadTexture, makeFullscreenVao, resizeCanvas } from "./overlayGl";
import { ISLAND_MIST_FRAG, ISLAND_MIST_VERT } from "./shaders/islandMist";

/** Mist canvas parented to an island wrapper so it inherits that island's
 *  CSS transform, size, and responsive layout 1:1. No viewport math. */
export default function IslandMist({ src }: { src: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ATMO.enabled || !ATMO.mist) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    let disposed = false;
    let tex: WebGLTexture | null = null;
    let program: WebGLProgram | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    let position: WebGLBuffer | null = null;
    let raf = 0;
    let start = performance.now();

    const draw = (now: number) => {
      if (disposed || document.visibilityState === "hidden" || !program || !vao) return;
      const { width, height } = resizeCanvas(canvas, gl, 1.5);
      const t = (now - start) / 1000;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      if (tex) gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(program, "uIsland"), 0);
      gl.uniform2f(gl.getUniformLocation(program, "uResolution"), width, height);
      gl.uniform1f(gl.getUniformLocation(program, "uTime"), t);
      gl.uniform1f(gl.getUniformLocation(program, "uReducedMotion"), REDUCED_MOTION ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "uIntensity"), INTENSITY);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(draw);
    };

    (async () => {
      try {
        program = createProgram(gl, ISLAND_MIST_VERT, ISLAND_MIST_FRAG);
        const geo = makeFullscreenVao(gl, program);
        vao = geo.vao;
        position = geo.position;
        tex = await loadTexture(gl, src, 0);
        if (disposed) {
          gl.deleteTexture(tex);
          tex = null;
          return;
        }
        raf = requestAnimationFrame(draw);
      } catch {
        /* fail closed */
      }
    })();

    const onVis = () => {
      if (document.visibilityState === "hidden") cancelAnimationFrame(raf);
      else if (!disposed) {
        start = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      if (tex) gl.deleteTexture(tex);
      if (position) gl.deleteBuffer(position);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
    };
  }, [src]);

  if (!ATMO.enabled || !ATMO.mist) return null;
  return <canvas ref={canvasRef} className="cloudscape__island-mist" aria-hidden="true" />;
}
