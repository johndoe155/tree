import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO } from "@react-three/postprocessing";
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import {
  BASE_FOV,
  BLOOM_INTENSITY,
  BLOOM_LUMINANCE_SMOOTHING,
  BLOOM_LUMINANCE_THRESHOLD,
  BLOOM_RADIUS,
  CAMERA_FAR,
  CAMERA_NEAR,
  CAMERA_POSITION,
  DEPTH_URL,
  FOG_COLOR,
  HDRI_URL_DESKTOP,
  HDRI_URL_MOBILE,
  KEY_LIGHT_INTENSITY,
  MOBILE_FOV,
  NIGHT_BLUE,
  PHOTO_URL,
  SKY_COVER,
  SKY_VIEW_DEPTH,
  STUDIO_ENV_INTENSITY,
  STUDIO_EXPOSURE,
} from "./constants";
import { createDirector } from "./director";
import { CloudscapeFinish, type CloudscapeFinishEffect } from "./finish";
import CloudscapeIslands from "./CloudscapeIslands";
import CloudscapeModel from "./CloudscapeModel";
import {
  fitWorldSize,
  fogRangeFor,
  placeBillboard,
  viewDepthAtOrigin,
} from "./layout";
import { PLANE_VERTEX, SKY_FRAGMENT } from "./shaders";
import { useStudioEnvironment, useTexture } from "./assets";
import {
  diagLayersReady,
  logDiag,
  readDiagLayers,
  setDiagLayer,
  setDiagLoopInfo,
} from "./diagnostics";

const IS_MOBILE =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 767px)").matches);

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type Director = ReturnType<typeof createDirector>;

/**
 * One clock, one pointer and one atmosphere for the whole scene.
 *
 * The fog range is derived from the *fitted* size of the centre island instead of fixed world units,
 * because the scene is rescaled to the viewport: the same numbers have to mean the same amount of
 * atmosphere on a phone and on a 5K display.
 */
function SceneDirector({
  director,
  fogRef,
  finishRef,
}: {
  director: Director;
  fogRef: React.RefObject<THREE.Fog | null>;
  finishRef: React.RefObject<CloudscapeFinishEffect | null>;
}) {
  const camera = useThree(state => state.camera);
  const gl = useThree(state => state.gl);

  useEffect(() => {
    const handleResize = () => {
      const aspect = window.innerWidth / window.innerHeight;
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = aspect < 0.72 ? MOBILE_FOV : BASE_FOV;
        camera.updateProjectionMatrix();
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [camera]);

  const pointerGoal = useRef(new THREE.Vector2());
  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      pointerGoal.current.set(
        (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2,
        (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2
      );
    };
    window.addEventListener("pointermove", handlePointer, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointer);
  }, []);

  // A negative priority only orders this subscriber first: R3F hands rendering to whoever subscribes
  // with a *positive* priority, which is the composer. `gl` stays untouched, so R3F keeps owning the
  // drawing-buffer size (setting the pixel ratio here would resize it behind R3F's back).
  useFrame((state, delta) => {
    director.time += delta;
    director.motion = REDUCED_MOTION ? 0 : 1;
    director.reducedMotion = REDUCED_MOTION ? 1 : 0;
    director.pointer.lerp(pointerGoal.current, 0.06);

    if (camera instanceof THREE.PerspectiveCamera && fogRef.current) {
      const fit = fitWorldSize(
        state.viewport.width,
        state.viewport.height,
        state.size.width
      );
      const { near, far } = fogRangeFor(viewDepthAtOrigin(camera), fit);
      fogRef.current.near = near;
      fogRef.current.far = far;
    }
    if (finishRef.current) finishRef.current.time = director.time;
  }, -1);

  return null;
}

/** The cloudscape plate, driven by its own depth map. Fog is off: this *is* the sky. */
function SkyPlate({ director }: { director: Director }) {
  const photo = useTexture(PHOTO_URL);
  const depth = useTexture(DEPTH_URL, { linearData: true });
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uPhoto: { value: null as THREE.Texture | null },
      uDepth: { value: null as THREE.Texture | null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uImageAspect: { value: 1 },
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uReducedMotion: { value: 0 },
      uCover: { value: SKY_COVER },
    }),
    []
  );

  const ready = Boolean(photo.data && depth.data);

  useEffect(() => {
    setDiagLayer(
      "plate",
      photo.stage === "ready" && depth.stage === "ready"
        ? "ready"
        : photo.stage === "failed" || depth.stage === "failed"
          ? "failed"
          : "loading"
    );
  }, [photo.stage, depth.stage]);

  useEffect(() => {
    if (!photo.data || !depth.data) return;
    uniforms.uPhoto.value = photo.data;
    uniforms.uDepth.value = depth.data;
    const image = photo.data.image as { width?: number; height?: number };
    if (image?.width && image.height)
      uniforms.uImageAspect.value = image.width / image.height;
  }, [photo.data, depth.data, uniforms]);

  useFrame(state => {
    if (!ready) return;
    const camera = state.camera as THREE.PerspectiveCamera;
    const size = state.size;
    uniforms.uResolution.value.set(size.width, size.height);
    uniforms.uTime.value = director.time;
    uniforms.uPointer.value.copy(director.pointer);
    uniforms.uReducedMotion.value = director.reducedMotion;
    if (meshRef.current) {
      const cover = SKY_COVER;
      placeBillboard(
        meshRef.current,
        camera,
        size,
        viewDepthAtOrigin(camera) + SKY_VIEW_DEPTH,
        {
          x: -(size.width * (cover - 1)) / 2,
          y: -(size.height * (cover - 1)) / 2,
          width: size.width * cover,
          height: size.height * cover,
        }
      );
    }
  });

  if (!ready) return null;

  return (
    <mesh ref={meshRef} renderOrder={-10} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={PLANE_VERTEX}
        fragmentShader={SKY_FRAGMENT}
        uniforms={uniforms}
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  );
}

/**
 * The studio HDRI, prefiltered by hand instead of through a suspending component: reflections are the
 * most expensive thing on the page after the model and they must never be able to hold the frame up.
 */
function StudioEnvironment() {
  const url = IS_MOBILE ? HDRI_URL_MOBILE : HDRI_URL_DESKTOP;
  const stage = useStudioEnvironment(url, STUDIO_ENV_INTENSITY);
  useEffect(() => setDiagLayer("hdri", stage), [stage]);
  return null;
}

/**
 * Tells the page when the canvas is genuinely showing something, and keeps a live summary of the
 * render loop for the dev overlay.
 *
 * Readiness used to be a bare `requestAnimationFrame`, which can fire on a canvas that has never been
 * drawn to: the photograph faded out, a blank clear colour took its place, and the difference between
 * "still loading" and "broken" disappeared with it. So the gate is a real read of the framebuffer -
 * a few sampled pixels that must differ from the clear colour - which makes a blank reveal
 * unreachable and doubles as the diagnostic: the colours it saw are reported every second until then.
 */
const PROBE_POINTS: Array<[number, number]> = [
  [0.5, 0.5],
  [0.26, 0.28],
  [0.74, 0.62],
  [0.5, 0.86],
];

function PaintWatcher({ onPainted }: { onPainted: () => void }) {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  // Who owns rendering, and who is subscribed: the two numbers that name a starved frame loop.
  const priority = useThree(state => state.internal.priority);
  const subscribers = useThree(state => state.internal.subscribers.length);
  const frameloop = useThree(state => state.frameloop);
  const done = useRef(false);
  const probe = useRef(new Uint8Array(4));
  const last = useRef("not sampled yet");
  const startedAt = useRef(0);
  const lastFrame = useRef(0);
  const starved = useRef(0);
  const takeOver = useRef(false);
  const renderedDirectly = useRef(false);

  /*
   * The reveal waits for a frame that was really rendered. Reading it that way matters because
   * `useFrame`'s second argument is not an ordering hint: any subscriber with a positive priority
   * tells R3F "I will render", and R3F then drops `gl.render` for the whole tree
   * (fiber/dist/index: `if (!state.internal.priority && state.gl.render) ...`). An earlier version of
   * this watcher probed at priority 20 and so silently took rendering away from everyone, including
   * the post-processing composer - the loop ran, nothing drew, the buffer stayed the clear colour,
   * and the gate that needed a painted frame never opened. Probing at priority 0 keeps the frame loop
   * exactly as the composer expects it.
   *
   * `info.render.frame` is incremented inside WebGLRenderer.render and is never zeroed - three's
   * info.reset() clears calls/triangles/points/lines only, and postprocessing calls it after its last
   * pass - so it is the one reliable proof that a frame was drawn. `calls` is deliberately not part of
   * the test: this subscriber runs before the composer, so it would always read the value left by
   * that reset, which is zero. Content comes from the layers themselves instead, since a scene with no
   * meshes still renders frames. Pixels are read for the report only: at this point in the frame the
   * drawing buffer has been presented, and reading it then is not guaranteed to return the image.
   */
  useFrame(state => {
    const info = gl.info.render;

    // Starvation guard. The composer subscribes at priority 1, which tells R3F to stand down, and
    // then returns early every frame until its own mount effect has produced a composer instance. If
    // that effect never completes - a pass that fails to construct, an option combination the
    // renderer refuses - R3F stays stood down and nothing renders at all: loop alive, buffer empty,
    // no error anywhere, which is how this scene presented for three rounds. So when nobody else is
    // producing frames, the scene is rendered directly instead. Post-processing is lost and says so
    // loudly; a blank page is not an acceptable substitute.
    //
    // Frames drawn here are subtracted before deciding, otherwise the fallback would run every other
    // frame and each of its own frames would read as a recovery.
    const advance = info.frame - lastFrame.current;
    lastFrame.current = info.frame;
    const fromOthers = advance - (renderedDirectly.current ? 1 : 0);
    if (fromOthers > 0) {
      if (takeOver.current)
        logDiag("composer resumed; direct rendering stopped");
      starved.current = 0;
      takeOver.current = false;
      renderedDirectly.current = false;
    } else {
      starved.current += 1;
      if (starved.current === 3) {
        takeOver.current = true;
        logDiag(
          `no frames from r3f or the composer; rendering directly without post-processing (${readDiagLayers()})`
        );
      }
      renderedDirectly.current = takeOver.current;
      if (takeOver.current) state.gl.render(state.scene, state.camera);
    }

    if (done.current) return;

    if (info.frame > 0 && diagLayersReady(["plate", "islands"])) {
      done.current = true;
      // One rAF later so the frame being waited on has actually reached the screen before the canvas
      // is unmasked.
      requestAnimationFrame(() => {
        logDiag(
          `painted: frames=${info.frame} layers=${readDiagLayers()} samples=${last.current} programs=${gl.info.programs?.length ?? 0}`
        );
        onPainted();
      });
      return;
    }

    if (startedAt.current === 0) startedAt.current = performance.now();
    if (performance.now() - startedAt.current > 6000) {
      startedAt.current = performance.now();
      logDiag(
        `no frame after 6s: frames=${info.frame} calls=${info.calls} r3fPriority=${priority} subscribers=${subscribers} frameloop=${frameloop} buffer=${gl.domElement.width}x${gl.domElement.height}`
      );
    }
  });

  useEffect(() => {
    let id = 0;
    const report = () => {
      // A readPixels forces a GPU sync, so this samples at a tenth of a hertz and only while the
      // reveal is still pending.
      if (!done.current) {
        const context = gl.getContext();
        const width = gl.domElement.width;
        const height = gl.domElement.height;
        if (width > 1 && height > 1) {
          const seen: string[] = [];
          for (const [fx, fy] of PROBE_POINTS) {
            const x = Math.min(width - 1, Math.floor(fx * width));
            const y = Math.min(height - 1, Math.floor((1 - fy) * height));
            try {
              context.readPixels(
                x,
                y,
                1,
                1,
                context.RGBA,
                context.UNSIGNED_BYTE,
                probe.current
              );
            } catch {
              break;
            }
            seen.push(
              `#${Array.from(probe.current.slice(0, 3))
                .map(v => v.toString(16).padStart(2, "0"))
                .join("")}`
            );
          }
          last.current = seen.length
            ? seen.join(" ")
            : "readPixels unavailable";
        }
      }
      // Keep reporting until the heavy layers settle too: after the reveal the title is the only
      // place left that says whether the model arrived, and that is the question being asked.
      const layers = readDiagLayers();
      if (
        done.current &&
        /model:(ready|failed)/.test(layers) &&
        !takeOver.current
      ) {
        window.clearInterval(id);
        return;
      }
      const info = gl.info.render;
      setDiagLoopInfo(
        `loop frames=${info.frame} calls=${info.calls} r3fPriority=${priority} subs=${subscribers} loop=${frameloop} buffer=${gl.domElement.width}x${gl.domElement.height} css=${Math.round(size.width)}x${Math.round(size.height)} dpr=${gl.getPixelRatio().toFixed(2)} direct=${takeOver.current ? "yes" : "no"} samples=${last.current} depth=${viewDepthAtOrigin(camera).toFixed(2)} lost=${gl.getContext().isContextLost()}`
      );
    };
    report();
    id = window.setInterval(report, 1000);
    return () => window.clearInterval(id);
  }, [gl, camera, size, priority, subscribers, frameloop]);

  return null;
}

/**
 * Mount witness. `@react-three/postprocessing` renders `null` until its own mount effect has built a
 * composer, so the children below it exist only in that case: a line here means "the composer is
 * initialised and its passes exist", and its absence with a starved frame loop means the composer
 * never got that far. Those two states look identical from the outside and need different fixes.
 */
function FinishWitness({ children }: { children: ReactNode }) {
  useEffect(() => {
    logDiag("composer children mounted (composer initialised)");
  }, []);
  return <>{children}</>;
}

/**
 * A post-processing pass that cannot construct itself should not be able to unmount the scene. The
 * error is reported through the same channels as everything else, so the readable state says the
 * finish pass is off and why instead of leaving a silent empty canvas.
 */
class PassHost extends Component<{ children: ReactNode; label: string }> {
  state = { failed: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    logDiag(
      `${this.props.label} disabled: ${this.state.failed || (error instanceof Error ? error.message : "unknown error")}`
    );
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function HeavyLayers({ director }: { director: Director }) {
  useEffect(() => {
    logDiag("heavy layers requested (model + hdri)");
  }, []);
  return (
    <>
      <CloudscapeModel director={director} />
      <StudioEnvironment />
    </>
  );
}

function Scene({
  director,
  onPainted,
}: {
  director: Director;
  onPainted: () => void;
}) {
  const fogRef = useRef<THREE.Fog>(null);
  const finishRef = useRef<CloudscapeFinishEffect>(null);

  return (
    <>
      <SceneDirector
        director={director}
        fogRef={fogRef}
        finishRef={finishRef}
      />
      <fog ref={fogRef} attach="fog" args={[FOG_COLOR, 10, 40]} />
      <directionalLight
        position={[4.8, 4.2, 2]}
        intensity={KEY_LIGHT_INTENSITY}
        color="#fffaf4"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-bias={-0.0002}
        shadow-normalBias={0.025}
      />
      <directionalLight
        position={[-3.5, 3.2, -4.5]}
        intensity={0.55}
        color="#9aa8d0"
      />
      <directionalLight
        position={[2.5, 4.2, -3.5]}
        intensity={0.8}
        color="#c7cbe0"
      />
      <hemisphereLight args={["#9da8bb", "#090a0d", 0.14]} />
      <SkyPlate director={director} />
      <CloudscapeIslands director={director} />
      <PaintWatcher onPainted={onPainted} />
      <PassHost label="post-processing">
        <EffectComposer multisampling={IS_MOBILE ? 0 : 4}>
          <N8AO aoRadius={0.35} intensity={1.35} distanceFalloff={1.2} />
          <Bloom
            mipmapBlur
            intensity={BLOOM_INTENSITY}
            luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
            luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
            radius={BLOOM_RADIUS}
          />
          <FinishWitness>
            <CloudscapeFinish ref={finishRef} />
          </FinishWitness>
        </EffectComposer>
      </PassHost>
    </>
  );
}

export default function CloudscapeScene({
  ready,
  onReady,
}: {
  ready: boolean;
  onReady: () => void;
}) {
  const director = useMemo(() => createDirector(), []);
  // Nothing inside the canvas suspends any more, so the scene tree can be built once: the reveal
  // class below is a CSS-only change and must not rebuild every material and texture.
  const scene = useMemo(
    () => <Scene director={director} onPainted={onReady} />,
    [director, onReady]
  );
  const heavy = useMemo(
    () => (ready ? <HeavyLayers director={director} /> : null),
    [ready, director]
  );

  return (
    <Canvas
      className={`cloudscape__canvas${ready ? " is-ready" : ""}`}
      shadows={{ type: THREE.PCFSoftShadowMap }}
      dpr={[1, 2]}
      gl={{
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      }}
      camera={{
        position: CAMERA_POSITION,
        fov: BASE_FOV,
        near: CAMERA_NEAR,
        far: CAMERA_FAR,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color(NIGHT_BLUE), 1);
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = STUDIO_EXPOSURE;
        logDiag(
          `canvas created ${gl.domElement.width}x${gl.domElement.height} dpr=${gl.getPixelRatio()} webgl2=${gl.capabilities.isWebGL2}`
        );
      }}
    >
      {scene}
      {heavy}
    </Canvas>
  );
}
