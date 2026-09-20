import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef } from "react";
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
  logDiag,
  readDiagLayers,
  setDiagLayer,
  setDiagSummary,
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
  const done = useRef(false);
  const probe = useRef(new Uint8Array(4));
  const last = useRef("no sample yet");

  // Above the composer's priority, so this runs after the frame has been drawn to the canvas.
  useFrame(() => {
    // readPixels synchronises the GPU, so probing stops the moment the reveal has been granted.
    if (done.current) return;
    const info = gl.info.render;
    const context = gl.getContext();
    const width = gl.domElement.width;
    const height = gl.domElement.height;
    let painted = false;
    if (width > 1 && height > 1) {
      let difference = 0;
      const seen: string[] = [];
      for (const [fx, fy] of PROBE_POINTS) {
        // WebGL reads bottom-up, hence the flipped y.
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
        const r = probe.current[0];
        const g = probe.current[1];
        const b = probe.current[2];
        seen.push(
          `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`
        );
        // The plate is never uniform, so anything that leaves the clear colour means pixels arrived.
        difference += Math.abs(r - 23) + Math.abs(g - 19) + Math.abs(b - 49);
      }
      last.current = seen.length ? seen.join(" ") : "readPixels unavailable";
      painted = difference > 40;
    }

    if (!done.current && info.frame > 0 && painted) {
      done.current = true;
      logDiag(
        `painted: frames=${info.frame} buffer=${width}x${height} samples=${last.current} programs=${gl.info.programs?.length ?? 0}`
      );
      onPainted();
    }
  }, 20);

  useEffect(() => {
    let id = 0;
    const report = () => {
      if (done.current) {
        window.clearInterval(id);
        return;
      }
      const info = gl.info.render;
      setDiagSummary(
        `${readDiagLayers()} | loop frames=${info.frame} buffer=${gl.domElement.width}x${gl.domElement.height} css=${Math.round(size.width)}x${Math.round(size.height)} dpr=${gl.getPixelRatio().toFixed(2)} samples=${last.current} programs=${gl.info.programs?.length ?? 0} geometries=${gl.info.memory.geometries} textures=${gl.info.memory.textures} depth=${viewDepthAtOrigin(camera).toFixed(2)} contextLost=${gl.getContext().isContextLost()}`
      );
    };
    report();
    id = window.setInterval(report, 1500);
    return () => window.clearInterval(id);
  }, [gl, camera, size]);

  return null;
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
      <EffectComposer multisampling={IS_MOBILE ? 0 : 4}>
        <N8AO aoRadius={0.35} intensity={1.35} distanceFalloff={1.2} />
        <Bloom
          mipmapBlur
          intensity={BLOOM_INTENSITY}
          luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
          luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
          radius={BLOOM_RADIUS}
        />
        <CloudscapeFinish ref={finishRef} />
      </EffectComposer>
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
