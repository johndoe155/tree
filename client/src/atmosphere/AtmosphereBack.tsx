import { useEffect, useRef } from "react";
import { ATMO, INTENSITY, IS_MOBILE, REDUCED_MOTION } from "./config";
import { createProgram, makeFullscreenVao, startOverlayLoop } from "./overlayGl";
import { BACK_FRAG, BACK_VERT } from "./shaders/back";

const pointer = { x: 0, y: 0 };

export default function AtmosphereBack() {
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
    let program: WebGLProgram | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    let position: WebGLBuffer | null = null;
    let loop: { dispose: () => void } | null = null;

    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      pointer.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    try {
      program = createProgram(gl, BACK_VERT, BACK_FRAG);
      const geo = makeFullscreenVao(gl, program);
      vao = geo.vao;
      position = geo.position;
      const loc = {
        resolution: gl.getUniformLocation(program, "uResolution"),
        time: gl.getUniformLocation(program, "uTime"),
        pointer: gl.getUniformLocation(program, "uPointer"),
        reduced: gl.getUniformLocation(program, "uReducedMotion"),
        intensity: gl.getUniformLocation(program, "uIntensity"),
        sunGlow: gl.getUniformLocation(program, "uSunGlow"),
        life: gl.getUniformLocation(program, "uLife"),
      };
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      loop = startOverlayLoop({
        canvas,
        gl,
        maxDpr: IS_MOBILE ? 1.25 : 1.5,
        draw: (t, w, h) => {
          if (!program || !vao) return;
          gl.useProgram(program);
          gl.bindVertexArray(vao);
          gl.uniform2f(loc.resolution, w, h);
          gl.uniform1f(loc.time, t);
          gl.uniform2f(loc.pointer, pointer.x, pointer.y);
          gl.uniform1f(loc.reduced, REDUCED_MOTION ? 1 : 0);
          gl.uniform1f(loc.intensity, INTENSITY);
          gl.uniform1f(loc.sunGlow, ATMO.sunGlow ? 1 : 0);
          gl.uniform1f(loc.life, ATMO.life ? 1 : 0);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        },
      });
    } catch {
      /* additive overlay — fail closed */
    }

    return () => {
      disposed = true;
      window.removeEventListener("pointermove", onPointer);
      loop?.dispose();
      if (position) gl.deleteBuffer(position);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
    };
  }, []);

  if (!ATMO.enabled) return null;
  return <canvas ref={canvasRef} className="cloudscape__atmo-back" aria-hidden="true" />;
}
