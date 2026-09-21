/** Shared WebGL2 helpers for the additive overlay canvases.
 *  Isolated from Home.tsx's background shader — never shares a context. */

export function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vs);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Program linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export function makeFullscreenVao(gl: WebGL2RenderingContext, program: WebGLProgram, attr = "aPosition") {
  const position = gl.createBuffer();
  const vao = gl.createVertexArray();
  if (!position || !vao) throw new Error("Unable to create VAO");
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, position);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, attr);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, position };
}

export function loadTexture(gl: WebGL2RenderingContext, url: string, unit: number) {
  return new Promise<WebGLTexture>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const texture = gl.createTexture();
      if (!texture) {
        reject(new Error("Unable to create texture"));
        return;
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      resolve(texture);
    };
    image.onerror = () => reject(new Error(`Unable to load ${url}`));
    image.src = url;
  });
}

export function resizeCanvas(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, maxDpr = 2) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxDpr);
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const width = Math.max(1, Math.floor(cssW * pixelRatio));
  const height = Math.max(1, Math.floor(cssH * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
  return { width, height, pixelRatio };
}

export type OverlayLoop = {
  dispose: () => void;
};

export function startOverlayLoop(opts: {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  draw: (t: number, w: number, h: number) => void;
  maxDpr?: number;
}): OverlayLoop {
  const { canvas, gl, draw, maxDpr = 2 } = opts;
  let disposed = false;
  let raf = 0;
  let start = performance.now();

  const render = (now: number) => {
    if (disposed || document.visibilityState === "hidden") return;
    const { width, height } = resizeCanvas(canvas, gl, maxDpr);
    draw((now - start) / 1000, width, height);
    raf = requestAnimationFrame(render);
  };

  const pause = () => cancelAnimationFrame(raf);
  const resume = () => {
    if (disposed || document.visibilityState === "hidden") return;
    cancelAnimationFrame(raf);
    start = performance.now();
    raf = requestAnimationFrame(render);
  };
  const onVis = () => {
    if (document.visibilityState === "hidden") pause();
    else resume();
  };

  window.addEventListener("resize", resume, { passive: true });
  document.addEventListener("visibilitychange", onVis);
  raf = requestAnimationFrame(render);

  return {
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resume);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
