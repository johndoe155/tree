import { useEffect, useRef, type RefObject } from "react";

const TREE_URL = "/tree-island.png";
const STATUE_URL = "/statue-island.png";

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// This shader is deliberately a separate transparent compositing pass. It does
// not share a renderer, material, uniform, or render state with the GLB canvas.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uTree;
uniform sampler2D uStatue;
uniform vec4 uTreeBounds;
uniform vec4 uStatueBounds;
uniform float uTime;
uniform float uMotion;

in vec2 vUv;
out vec4 outColor;

const vec3 FOG_COLOR = vec3(0.600, 0.423, 0.650);
const vec3 MIST_COLOR = vec3(0.735, 0.545, 0.710);

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 3; octave++) {
    value += noise(p) * amplitude;
    p = p * 2.03 + 11.7;
    amplitude *= 0.5;
  }
  return value;
}

bool outside(vec2 point, vec4 bounds) {
  return bounds.z <= 0.0 || bounds.w <= 0.0 || point.x < bounds.x || point.x > bounds.x + bounds.z || point.y < bounds.y || point.y > bounds.y + bounds.w;
}

vec4 foggedIsland(sampler2D islandMap, vec4 bounds, vec2 screenUv) {
  // Keep derivatives outside conditional flow so the small defocus remains
  // well-defined along a PNG's edge on all WebGL2 implementations.
  vec2 localUv = (screenUv - bounds.xy) / max(bounds.zw, vec2(0.0001));
  vec2 blurStep = max(fwidth(localUv) * 0.52, vec2(0.00008));
  if (outside(screenUv, bounds)) return vec4(0.0);

  // DOM layout keeps the original responsive sizing and floating paths. This
  // pass only reads those live bounds and shades the PNG inside them.
  vec2 textureUv = vec2(localUv.x, 1.0 - localUv.y);
  vec4 center = texture(islandMap, textureUv);

  // A fractional-pixel five-tap defocus creates depth separation without
  // softening the alpha silhouette or changing the original PNG geometry.
  vec3 softlyBlurred = (
    center.rgb * 4.0 +
    texture(islandMap, textureUv + vec2(blurStep.x, 0.0)).rgb +
    texture(islandMap, textureUv - vec2(blurStep.x, 0.0)).rgb +
    texture(islandMap, textureUv + vec2(0.0, blurStep.y)).rgb +
    texture(islandMap, textureUv - vec2(0.0, blurStep.y)).rgb
  ) / 8.0;
  vec3 color = mix(center.rgb, softlyBlurred, 0.24);

  // Atmospheric perspective: gently lower saturation and contrast, lift the
  // deepest values, then blend toward the cloud/sky palette. The alpha is
  // preserved verbatim so PNG cut-outs continue to composite cleanly.
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, 0.87);
  float lowerAir = smoothstep(0.34, 0.92, localUv.y);
  float fogAmount = 0.155 + lowerAir * 0.065;
  color = mix(color, FOG_COLOR, fogAmount);
  color = max(color, FOG_COLOR * 0.045);

  return vec4(color, center.a);
}

float islandMist(vec2 screenUv, vec4 bounds, float timeOffset) {
  if (bounds.z <= 0.0 || bounds.w <= 0.0) return 0.0;

  // The haze is centered at the lower third of the illustrated island and is
  // deliberately wider than the cut-out, letting a few cloud wisps cross both
  // its silhouette and the nearby sky.
  vec2 localUv = (screenUv - bounds.xy) / bounds.zw;
  float t = uTime * uMotion + timeOffset;
  float horizontal = (localUv.x - 0.5) / 0.82;
  float vertical = (localUv.y - 0.735) / 0.118;
  float cloudBody = exp(-horizontal * horizontal * 1.65 - vertical * vertical * 2.9);
  float edgeBreakup = fbm(vec2(localUv.x * 3.1 - t * 0.032, localUv.y * 8.0 + t * 0.018));
  float streak = 0.5 + 0.5 * sin(localUv.x * 18.0 + edgeBreakup * 5.0 + t * 0.19);
  float wisps = smoothstep(0.26, 0.72, edgeBreakup * 0.78 + streak * 0.22);
  return cloudBody * wisps * 0.165;
}

void compositeOver(inout vec3 premultiplied, inout float alpha, vec4 layer) {
  premultiplied = layer.rgb * layer.a + premultiplied * (1.0 - layer.a);
  alpha = layer.a + alpha * (1.0 - layer.a);
}

void main() {
  // CSS positions are top-left based while vUv is bottom-left based.
  vec2 screenUv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 tree = foggedIsland(uTree, uTreeBounds, screenUv);
  vec4 statue = foggedIsland(uStatue, uStatueBounds, screenUv);

  vec3 premultiplied = vec3(0.0);
  float alpha = 0.0;
  compositeOver(premultiplied, alpha, tree);
  compositeOver(premultiplied, alpha, statue);

  // This is intentionally composed after both PNGs, placing the cloud volume
  // in front of their lower tips rather than behind them.
  float mist = max(islandMist(screenUv, uTreeBounds, 0.0), islandMist(screenUv, uStatueBounds, 4.1));
  compositeOver(premultiplied, alpha, vec4(MIST_COLOR, mist));

  vec3 color = alpha > 0.0001 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(color, alpha);
}`;

interface AtmosphericIslandLayerProps {
  treeRef: RefObject<HTMLImageElement | null>;
  statueRef: RefObject<HTMLImageElement | null>;
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) {
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

function createProgram(gl: WebGL2RenderingContext) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
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

function loadTexture(gl: WebGL2RenderingContext, url: string, unit: number) {
  return new Promise<WebGLTexture>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const texture = gl.createTexture();
      if (!texture) {
        reject(new Error("Unable to create island texture"));
        return;
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image
      );
      resolve(texture);
    };
    image.onerror = () => reject(new Error(`Unable to load ${url}`));
    image.src = url;
  });
}

function getBounds(element: HTMLImageElement | null, canvasRect: DOMRect) {
  if (!element || canvasRect.width === 0 || canvasRect.height === 0)
    return [-2, -2, 0, 0] as const;
  const rect = element.getBoundingClientRect();
  return [
    (rect.left - canvasRect.left) / canvasRect.width,
    (rect.top - canvasRect.top) / canvasRect.height,
    rect.width / canvasRect.width,
    rect.height / canvasRect.height,
  ] as const;
}

function getDrawRegion(bounds: readonly (readonly [number, number, number, number])[]) {
  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;

  for (const [x, y, width, height] of bounds) {
    if (width <= 0 || height <= 0) continue;
    // Includes the wide, low-opacity front mist without turning this into a
    // full-screen shader pass. The image itself occupies only a small region.
    left = Math.min(left, x - width * 0.92);
    right = Math.max(right, x + width * 1.92);
    top = Math.min(top, y - height * 0.1);
    bottom = Math.max(bottom, y + height * 1.02);
  }

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    right: Math.min(1, right),
    bottom: Math.min(1, bottom),
  };
}

export default function AtmosphericIslandLayer({
  treeRef,
  statueRef,
}: AtmosphericIslandLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const islandHost = canvas?.parentElement;
    if (!canvas || !islandHost) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    let disposed = false;
    let animationFrame = 0;
    let treeTexture: WebGLTexture | null = null;
    let statueTexture: WebGLTexture | null = null;
    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const program = createProgram(gl);
    const position = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!position || !vao) {
      gl.deleteProgram(program);
      return;
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const positionLocation = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const treeLocation = gl.getUniformLocation(program, "uTree");
    const statueLocation = gl.getUniformLocation(program, "uStatue");
    const treeBoundsLocation = gl.getUniformLocation(program, "uTreeBounds");
    const statueBoundsLocation = gl.getUniformLocation(
      program,
      "uStatueBounds"
    );
    const timeLocation = gl.getUniformLocation(program, "uTime");
    const motionLocation = gl.getUniformLocation(program, "uMotion");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // The assets are small on screen; a capped backing store avoids adding a
      // high-resolution full-screen pass to the existing two renderers.
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.floor(rect.width * pixelRatio));
      const height = Math.max(1, Math.floor(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      return rect;
    };

    const draw = (now: number) => {
      if (
        disposed ||
        document.visibilityState === "hidden" ||
        !treeTexture ||
        !statueTexture
      )
        return;
      const canvasRect = resize();
      const treeBounds = getBounds(treeRef.current, canvasRect);
      const statueBounds = getBounds(statueRef.current, canvasRect);

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, treeTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, statueTexture);
      gl.uniform4f(treeBoundsLocation, ...treeBounds);
      gl.uniform4f(statueBoundsLocation, ...statueBounds);
      gl.uniform1f(timeLocation, now / 1000);
      gl.uniform1f(motionLocation, motionMedia.matches ? 0 : 1);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Rasterize only the two small illustrated regions (plus their mist),
      // rather than paying for another full-resolution scene pass.
      const region = getDrawRegion([treeBounds, statueBounds]);
      if (region.right > region.left && region.bottom > region.top) {
        const left = Math.floor(region.left * canvas.width);
        const bottom = Math.floor((1 - region.bottom) * canvas.height);
        const width = Math.ceil((region.right - region.left) * canvas.width);
        const height = Math.ceil((region.bottom - region.top) * canvas.height);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(left, bottom, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.SCISSOR_TEST);
      }

      if (!motionMedia.matches) animationFrame = requestAnimationFrame(draw);
    };

    const stop = () => cancelAnimationFrame(animationFrame);
    const start = () => {
      stop();
      if (
        document.visibilityState !== "hidden" &&
        treeTexture &&
        statueTexture
      ) {
        draw(performance.now());
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      stop();
      // Keep the unmodified DOM PNGs available as the fail-safe rendering path.
      islandHost.classList.remove("has-atmospheric-islands");
    };

    window.addEventListener("resize", start, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    motionMedia.addEventListener("change", start);

    Promise.all([loadTexture(gl, TREE_URL, 0), loadTexture(gl, STATUE_URL, 1)])
      .then(([loadedTree, loadedStatue]) => {
        if (disposed) {
          gl.deleteTexture(loadedTree);
          gl.deleteTexture(loadedStatue);
          return;
        }
        treeTexture = loadedTree;
        statueTexture = loadedStatue;
        gl.useProgram(program);
        gl.uniform1i(treeLocation, 0);
        gl.uniform1i(statueLocation, 1);
        islandHost.classList.add("has-atmospheric-islands");
        start();
      })
      .catch(() => {
        // No visual regression: leave the original <img> elements visible.
        islandHost.classList.remove("has-atmospheric-islands");
      });

    return () => {
      disposed = true;
      stop();
      islandHost.classList.remove("has-atmospheric-islands");
      window.removeEventListener("resize", start);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      motionMedia.removeEventListener("change", start);
      if (treeTexture) gl.deleteTexture(treeTexture);
      if (statueTexture) gl.deleteTexture(statueTexture);
      gl.deleteBuffer(position);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, [statueRef, treeRef]);

  return (
    <canvas
      ref={canvasRef}
      className="cloudscape__atmospheric-islands"
      aria-hidden="true"
    />
  );
}
