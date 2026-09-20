import { Environment } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
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
import CloudscapeIslands, { useSceneTexture } from "./CloudscapeIslands";
import CloudscapeModel from "./CloudscapeModel";
import {
  fitWorldSize,
  fogRangeFor,
  placeBillboard,
  viewDepthAtOrigin,
} from "./layout";
import { PLANE_VERTEX, SKY_FRAGMENT } from "./shaders";

const IS_MOBILE =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 767px)").matches);

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One clock, one pointer and one atmosphere for the whole scene.
 *
 * The fog range is derived from the *fitted* size of the centre island instead of fixed world
 * units, because the scene is rescaled to the viewport: the same numbers have to mean the same
 * amount of atmosphere on a phone and on a 5K display.
 */
function SceneDirector({
  director,
  fogRef,
  finishRef,
}: {
  director: ReturnType<typeof createDirector>;
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
      gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [camera, gl]);

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

  useFrame((_state, delta) => {
    director.time += delta;
    director.motion = REDUCED_MOTION ? 0 : 1;
    director.reducedMotion = REDUCED_MOTION ? 1 : 0;
    director.pointer.lerp(pointerGoal.current, 0.06);

    if (camera instanceof THREE.PerspectiveCamera && fogRef.current) {
      const fit = fitWorldSize(
        _state.viewport.width,
        _state.viewport.height,
        _state.size.width
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
function SkyPlate({
  director,
}: {
  director: ReturnType<typeof createDirector>;
}) {
  const photo = useSceneTexture(PHOTO_URL);
  const depth = useSceneTexture(DEPTH_URL, { linearData: true });
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uPhoto: { value: photo },
      uDepth: { value: depth },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uImageAspect: { value: 1 },
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uReducedMotion: { value: 0 },
      uCover: { value: SKY_COVER },
    }),
    [photo, depth]
  );

  useEffect(() => {
    const image = photo.image as { width?: number; height?: number } | null;
    if (image?.width && image.height)
      uniforms.uImageAspect.value = image.width / image.height;
  }, [photo, uniforms]);

  useFrame(state => {
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

/** Lets the page keep the still photo up until the first real frame is on screen. */
function FirstFrame({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    const raf = requestAnimationFrame(onReady);
    return () => cancelAnimationFrame(raf);
  }, [onReady]);
  return null;
}

function Scene({
  director,
  onReady,
}: {
  director: ReturnType<typeof createDirector>;
  onReady: () => void;
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
      <Suspense fallback={null}>
        <Environment
          files={IS_MOBILE ? HDRI_URL_MOBILE : HDRI_URL_DESKTOP}
          environmentIntensity={STUDIO_ENV_INTENSITY}
        />
        <SkyPlate director={director} />
        <CloudscapeIslands director={director} />
        <CloudscapeModel director={director} />
        <FirstFrame onReady={onReady} />
      </Suspense>
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
      }}
    >
      <Scene director={director} onReady={onReady} />
    </Canvas>
  );
}
