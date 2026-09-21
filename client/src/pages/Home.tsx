import { useEffect, useRef } from "react";
import CloudscapeModel from "@/components/CloudscapeModel";
import AtmosphereBack from "@/atmosphere/AtmosphereBack";
import AtmosphereFront from "@/atmosphere/AtmosphereFront";
import IslandMist from "@/atmosphere/IslandMist";
import FilmGrain from "@/atmosphere/FilmGrain";
import "@/atmosphere/atmosphere.css";

const PHOTO_URL = "/cloudscape-source.webp";
const DEPTH_URL = "/cloudscape-depth.webp";

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uPhoto;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uReducedMotion;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + 17.13;
    amplitude *= 0.5;
  }
  return value;
}

vec2 coverUv(vec2 uv) {
  float imageAspect = 2400.0 / 2172.0;
  float viewAspect = uResolution.x / uResolution.y;
  vec2 scale = vec2(1.0);
  if (viewAspect > imageAspect) {
    scale.y = imageAspect / viewAspect;
  } else {
    scale.x = viewAspect / imageAspect;
  }
  return (uv - 0.5) * scale + 0.5;
}

void main() {
  vec2 uv = coverUv(vUv);
  float depth = texture(uDepth, clamp(uv, 0.001, 0.999)).r;
  float cloudBand = smoothstep(0.30, 0.80, depth);
  float foreground = smoothstep(0.68, 1.0, depth);
  float upperSky = 1.0 - smoothstep(0.12, 0.54, depth);

  float motion = 1.0 - uReducedMotion;
  float t = uTime * motion;
  float slowNoise = fbm(uv * vec2(2.25, 5.7) + vec2(t * 0.012, -t * 0.006));
  float fineNoise = noise(uv * 17.0 + vec2(-t * 0.018, t * 0.009));

  float parallax = mix(0.00065, 0.0035, smoothstep(0.05, 0.95, depth));
  float cloudDrift = t * parallax;
  // Give the upper streaks their own faster lateral current instead of leaving
  // them nearly still while the cloud sea moves below.
  float upperDrift = t * 0.00225 * upperSky;
  float upperBreath = sin(t * 0.16 + uv.x * 5.0) * 0.00125 * upperSky;
  float billow = (slowNoise - 0.5) * (0.0018 + depth * 0.0048);
  float pointerX = uPointer.x * 0.003 * (0.25 + depth * 0.75);
  float pointerY = uPointer.y * 0.002 * (0.2 + depth * 0.8);

  float zoom = 1.012 + 0.006 * sin(t * 0.11);
  uv = (uv - 0.5) / zoom + 0.5;
  uv += vec2(cloudDrift + upperDrift + billow + pointerX, pointerY + upperBreath + sin(t * 0.08 + uv.x * 4.0) * 0.0008 * motion);

  vec3 color = texture(uPhoto, clamp(uv, 0.001, 0.999)).rgb;

  // A translucent procedural haze keeps the original pixels dominant while giving the cloud sea air.
  float haze = smoothstep(0.42, 0.98, depth) * (0.16 + 0.18 * slowNoise) * motion;
  vec3 lavenderFog = vec3(0.60, 0.34, 0.66);
  color = mix(color, lavenderFog, haze * 0.075);
  color += vec3(0.018, 0.006, 0.018) * (cloudBand * fineNoise);

  // Fine film grain, nearly imperceptible until the scene is in motion.
  float grain = hash21(gl_FragCoord.xy + vec2(uTime * 3.0)) - 0.5;
  color += grain * 0.012 * (0.25 + foreground * 0.75);
  color *= 0.985 + 0.015 * smoothstep(0.0, 1.0, vUv.y);

  outColor = vec4(color, 1.0);
}`;

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
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
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const texture = gl.createTexture();
      if (!texture) {
        reject(new Error("Unable to create texture"));
        return;
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
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

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const fallback = fallbackRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      fallback?.classList.add("is-visible");
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    let start = performance.now();
    let sceneReady = false;
    let lastFrame = 0;
    let loading = false;
    let pendingRestart = false;
    let resetToken = 0;
    let photoTexture: WebGLTexture | null = null;
    let depthTexture: WebGLTexture | null = null;
    const pointer = { x: 0, y: 0 };
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const program = createProgram(gl);
    const position = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!position || !vao) return;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const positionLocation = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, "uResolution");
    const timeLocation = gl.getUniformLocation(program, "uTime");
    const pointerLocation = gl.getUniformLocation(program, "uPointer");
    const reducedLocation = gl.getUniformLocation(program, "uReducedMotion");
    const photoLocation = gl.getUniformLocation(program, "uPhoto");
    const depthLocation = gl.getUniformLocation(program, "uDepth");

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
      const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const resetViewport = () => {
      // Browsers can restore a suspended canvas with a stale backing store. Setting
      // the dimensions to zero first forces the compositor to discard that store;
      // merely changing the viewport is not sufficient on affected GPU/driver pairs.
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = 0;
      canvas.height = 0;
      canvas.width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0.09, 0.075, 0.19, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.flush();
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      pointer.y = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };

    const render = (now: number) => {
      if (disposed || document.visibilityState === "hidden" || !sceneReady) return;
      resize();
      const elapsed = (now - start) / 1000;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, elapsed);
      gl.uniform2f(pointerLocation, pointer.x, pointer.y);
      gl.uniform1f(reducedLocation, prefersReducedMotion.matches ? 1 : 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      lastFrame = now;
      animationFrame = requestAnimationFrame(render);
    };

    const releaseTextures = () => {
      if (photoTexture) gl.deleteTexture(photoTexture);
      if (depthTexture) gl.deleteTexture(depthTexture);
      photoTexture = null;
      depthTexture = null;
    };

    const resumeScene = () => {
      if (disposed || document.visibilityState === "hidden") return;
      cancelAnimationFrame(animationFrame);
      // Do not expose a possibly stale framebuffer while the browser is bringing
      // the page back. The source image is a safe, non-smearing interim frame.
      sceneReady = false;
      canvas.classList.remove("is-ready");
      fallback?.classList.add("is-visible");
      releaseTextures();
      resetViewport();
      resetToken += 1;
      startScene(resetToken);
    };

    const pauseScene = () => cancelAnimationFrame(animationFrame);

    const startScene = async (token = resetToken) => {
      if (loading) {
        // A load is already in flight and will be discarded (its token is now stale).
        // Remember that a fresh load was requested so it runs once this one settles.
        pendingRestart = true;
        return;
      }
      loading = true;
      try {
        const [photo, depth] = await Promise.all([loadTexture(gl, PHOTO_URL, 0), loadTexture(gl, DEPTH_URL, 1)]);
        if (disposed || token !== resetToken || document.visibilityState === "hidden") {
          gl.deleteTexture(photo);
          gl.deleteTexture(depth);
          return;
        }
        photoTexture = photo;
        depthTexture = depth;
        gl.useProgram(program);
        gl.uniform1i(photoLocation, 0);
        gl.uniform1i(depthLocation, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, photo);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, depth);
        gl.clearColor(0.09, 0.075, 0.19, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        fallback?.classList.remove("is-visible");
        canvas.classList.add("is-ready");
        sceneReady = true;
        start = performance.now();
        lastFrame = 0;
        animationFrame = requestAnimationFrame(render);
      } catch {
        fallback?.classList.add("is-visible");
      } finally {
        loading = false;
        if (pendingRestart && !disposed) {
          pendingRestart = false;
          if (document.visibilityState !== "hidden") startScene(resetToken);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pauseScene();
      else resumeScene();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      pauseScene();
      sceneReady = false;
      canvas.classList.remove("is-ready");
      fallback?.classList.add("is-visible");
      releaseTextures();
    };
    const onContextRestored = () => {
      // Recreate all texture state after restoration instead of trusting the
      // browser to preserve bindings from the pre-loss context.
      resetToken += 1;
      resetViewport();
      startScene(resetToken);
    };

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", resumeScene, { passive: true });
    window.addEventListener("pagehide", pauseScene, { passive: true });
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    resize();
    startScene();

    return () => {
      disposed = true;
      resetToken += 1;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", resumeScene);
      window.removeEventListener("pagehide", pauseScene);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      releaseTextures();
      gl.deleteBuffer(position);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <main className="cloudscape" aria-label="Animated cloudscape">
      <canvas ref={canvasRef} className="cloudscape__canvas" aria-hidden="true" />
      <img ref={fallbackRef} className="cloudscape__fallback is-visible" src={PHOTO_URL} alt="" aria-hidden="true" />
      <AtmosphereBack />
      <div className="cloudscape__islands" aria-hidden="true">
        <div className="cloudscape__island cloudscape__island--tree">
          <img src="/tree-island.png" alt="" />
          <IslandMist src="/tree-island.png" />
        </div>
        <CloudscapeModel />
        <div className="cloudscape__island cloudscape__island--statue">
          <img src="/statue-island.png" alt="" />
          <IslandMist src="/statue-island.png" />
        </div>
      </div>
      <AtmosphereFront />
      <FilmGrain />
    </main>
  );
}
