import { useEffect, useRef } from "react";
import { ATMO, INTENSITY, IS_MOBILE, REDUCED_MOTION } from "./config";
import { createProgram, loadTexture, makeFullscreenVao, startOverlayLoop } from "./overlayGl";
import { islandToUv, measureScene } from "./sceneMeasure";
import { FRONT_FRAG, FRONT_VERT } from "./shaders/front";

const pointer = { x: 0, y: 0 };

export default function AtmosphereFront() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ATMO.enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    let disposed = false;
    let treeTex: WebGLTexture | null = null;
    let statueTex: WebGLTexture | null = null;
    let program: WebGLProgram | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    let position: WebGLBuffer | null = null;
    let loop: { dispose: () => void } | null = null;

    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      pointer.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    (async () => {
      try {
        program = createProgram(gl, FRONT_VERT, FRONT_FRAG);
        const geo = makeFullscreenVao(gl, program);
        vao = geo.vao;
        position = geo.position;
        const [tree, statue] = await Promise.all([
          loadTexture(gl, "/tree-island.png", 0),
          loadTexture(gl, "/statue-island.png", 1),
        ]);
        if (disposed) {
          gl.deleteTexture(tree);
          gl.deleteTexture(statue);
          return;
        }
        treeTex = tree;
        statueTex = statue;

        const loc = {
          resolution: gl.getUniformLocation(program, "uResolution"),
          time: gl.getUniformLocation(program, "uTime"),
          pointer: gl.getUniformLocation(program, "uPointer"),
          reduced: gl.getUniformLocation(program, "uReducedMotion"),
          intensity: gl.getUniformLocation(program, "uIntensity"),
          mist: gl.getUniformLocation(program, "uMist"),
          rays: gl.getUniformLocation(program, "uRays"),
          vignette: gl.getUniformLocation(program, "uVignette"),
          foreground: gl.getUniformLocation(program, "uForeground"),
          life: gl.getUniformLocation(program, "uLife"),
          treeTex: gl.getUniformLocation(program, "uTreeTex"),
          statueTex: gl.getUniformLocation(program, "uStatueTex"),
          treeBox: gl.getUniformLocation(program, "uTreeBox"),
          statueBox: gl.getUniformLocation(program, "uStatueBox"),
        };

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        loop = startOverlayLoop({
          canvas,
          gl,
          maxDpr: IS_MOBILE ? 1.25 : 1.75,
          draw: (t, w, h) => {
            if (!program || !vao) return;
            const m = measureScene();
            const treeBox = islandToUv(m.tree, m.viewport.w, m.viewport.h);
            const statueBox = islandToUv(m.statue, m.viewport.w, m.viewport.h);
            gl.useProgram(program);
            gl.bindVertexArray(vao);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, treeTex);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, statueTex);
            gl.uniform1i(loc.treeTex, 0);
            gl.uniform1i(loc.statueTex, 1);
            gl.uniform2f(loc.resolution, w, h);
            gl.uniform1f(loc.time, t);
            gl.uniform2f(loc.pointer, pointer.x, pointer.y);
            gl.uniform1f(loc.reduced, REDUCED_MOTION ? 1 : 0);
            gl.uniform1f(loc.intensity, INTENSITY);
            gl.uniform1f(loc.mist, 0);
            gl.uniform1f(loc.rays, ATMO.rays ? 1 : 0);
            gl.uniform1f(loc.vignette, ATMO.vignette ? 1 : 0);
            gl.uniform1f(loc.foreground, ATMO.foreground ? 1 : 0);
            gl.uniform1f(loc.life, ATMO.life ? 1 : 0);
            gl.uniform4f(loc.treeBox, ...treeBox);
            gl.uniform4f(loc.statueBox, ...statueBox);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
          },
        });
      } catch {
        /* overlay is additive; failure must not affect the scene */
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener("pointermove", onPointer);
      loop?.dispose();
      if (treeTex) gl.deleteTexture(treeTex);
      if (statueTex) gl.deleteTexture(statueTex);
      if (position) gl.deleteBuffer(position);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
    };
  }, []);

  if (!ATMO.enabled) return null;
  return <canvas ref={canvasRef} className="cloudscape__atmo-front" aria-hidden="true" />;
}
