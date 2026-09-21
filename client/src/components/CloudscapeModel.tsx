/// <reference types="@react-three/fiber" />
import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { EffectComposer, N8AO } from "@react-three/postprocessing";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import ModelAccents, { SunRimLight } from "@/components/model-accents/ModelAccents";

// The only mobile-specific rendering choice is the lighter HDRI asset.
const IS_MOBILE =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 767px)").matches);
const HDRI_URL = IS_MOBILE ? "/studio_small_08_1k.hdr" : "/studio_small_08_4k.hdr";
const MODEL_URL = "/model.glb";
const MODEL_ROTATION_Y = -Math.PI / 2;

const FLOAT_SPEED = 1.1;
const FLOAT_AMPLITUDE_BASE = 0.05;
const VIEWPORT_FIT_FACTOR = 0.78;
const BASE_FOV = 32;
const MOBILE_FOV = 38;
const KEY_LIGHT_INTENSITY = 2.4;
const STUDIO_EXPOSURE = 0.68;
const STUDIO_ENV_INTENSITY = 0.48;

// Material feel. Both values are multiplied with the model's metallic/roughness
// texture at render time, so the .glb itself is untouched.
const MATERIAL_METALNESS = 0.05; // 0 = never metallic
const MATERIAL_ROUGHNESS = 1.5; // >1 pushes rougher (final value caps at 1)

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FLOAT_AMPLITUDE = REDUCED_MOTION ? 0 : FLOAT_AMPLITUDE_BASE;
const FLOAT_PATH = [
  { phase: 0, value: 0 },
  { phase: 0.16, value: -1 },
  { phase: 0.28, value: -1 },
  { phase: 0.5, value: 0 },
  { phase: 0.66, value: 1 },
  { phase: 0.78, value: 1 },
  { phase: 1, value: 0 },
];

function sampleFloatPath(time: number) {
  const phase = ((time * FLOAT_SPEED) / (Math.PI * 2)) % 1;
  for (let index = 1; index < FLOAT_PATH.length; index += 1) {
    const next = FLOAT_PATH[index];
    if (phase <= next.phase) {
      const previous = FLOAT_PATH[index - 1];
      const segment = (phase - previous.phase) / (next.phase - previous.phase);
      const eased = segment * segment * (3 - 2 * segment);
      return previous.value + (next.value - previous.value) * eased;
    }
  }
  return 0;
}

// These uniforms and the shader patch are retained from the donor so the model's
// PBR materials remain byte-for-byte faithful. The hold uniforms are inert here:
// the standalone page's press-and-hold interaction is intentionally not mounted.
const HOLD_SCAN_DURATION = 1.4;
const HOLD_BAND_WIDTH_LEAD = 0.12;
const HOLD_BAND_WIDTH_TRAIL = 0.05;
const HOLD_SIDE_MASK_MIN = 0.2;
const HOLD_SIDE_MASK_MAX = 0.655;
const HOLD_FRONT_MASK_MIN = 0.2;
const HOLD_FRONT_MASK_MAX = 0.8;
const HOLD_WARP_AMOUNT_BASE = 0.007;
const HOLD_WARP_AMOUNT = REDUCED_MOTION ? 0 : HOLD_WARP_AMOUNT_BASE;
const HOLD_RIPPLE_AMOUNT_BASE = 0.002;
const HOLD_RIPPLE_AMOUNT = REDUCED_MOTION ? 0 : HOLD_RIPPLE_AMOUNT_BASE;
const HOLD_RIPPLE_FREQ = 9.0;
const HOLD_RIPPLE_SPEED = 6.0;
const HOLD_SPECULAR_BOOST = 2.4;
const HOLD_ROUGHNESS_SHIFT = 0.5;
const HOLD_RIM_POWER = 2.8;
const HOLD_RIM_BOOST = 2.2;
const HOLD_FLARE_INTENSITY = 3.0;
const HOLD_GLOW_COLOR = new THREE.Color("#ffd3e2");
const HOLD_GLOW_STRENGTH = 1.1;

// The host app uses React 19 typings while this donor integration targets the
// React Three Fiber v8 JSX runtime; these aliases preserve the exact elements
// while keeping the host compiler's JSX namespace happy.
const R3FGroup = "group" as any;
const R3FPrimitive = "primitive" as any;
const R3FDirectionalLight = "directionalLight" as any;
const R3FHemisphereLight = "hemisphereLight" as any;

function createHoldUniforms() {
  return {
    uHoldElapsed: { value: 0 },
    uIsHeld: { value: 0 },
    uFlux: { value: 1 },
    uMinZ: { value: 0 },
    uMaxZ: { value: 1 },
    uScanDuration: { value: HOLD_SCAN_DURATION },
    uBandWidthLead: { value: HOLD_BAND_WIDTH_LEAD },
    uBandWidthTrail: { value: HOLD_BAND_WIDTH_TRAIL },
    uSideMaskMin: { value: HOLD_SIDE_MASK_MIN },
    uSideMaskMax: { value: HOLD_SIDE_MASK_MAX },
    uFrontMaskMin: { value: HOLD_FRONT_MASK_MIN },
    uFrontMaskMax: { value: HOLD_FRONT_MASK_MAX },
    uWarpAmount: { value: HOLD_WARP_AMOUNT },
    uRippleAmount: { value: HOLD_RIPPLE_AMOUNT },
    uRippleFreq: { value: HOLD_RIPPLE_FREQ },
    uRippleSpeed: { value: HOLD_RIPPLE_SPEED },
    uModelScale: { value: 1 },
    uSpecularBoost: { value: HOLD_SPECULAR_BOOST },
    uRoughnessShift: { value: HOLD_ROUGHNESS_SHIFT },
    uRimBoost: { value: HOLD_RIM_BOOST },
    uRimPower: { value: HOLD_RIM_POWER },
    uFlareIntensity: { value: HOLD_FLARE_INTENSITY },
    uGlowColor: { value: HOLD_GLOW_COLOR.clone() },
    uGlowStrength: { value: HOLD_GLOW_STRENGTH },
  };
}

function installHoldShader(material: THREE.Material, uniforms: ReturnType<typeof createHoldUniforms>) {
  if (material.userData.holdUniforms) return material.userData.holdUniforms;
  material.userData.holdUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `
        #include <common>
        uniform float uHoldElapsed;
        uniform float uIsHeld;
        uniform float uMinZ;
        uniform float uMaxZ;
        uniform float uScanDuration;
        uniform float uBandWidthLead;
        uniform float uBandWidthTrail;
        uniform float uSideMaskMin;
        uniform float uSideMaskMax;
        uniform float uFrontMaskMin;
        uniform float uFrontMaskMax;
        uniform float uWarpAmount;
        uniform float uRippleAmount;
        uniform float uRippleFreq;
        uniform float uRippleSpeed;
        uniform float uModelScale;
        varying float vHoldSideMask;
        varying float vHoldSweepMask;
        varying vec3 vHoldViewNormal;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        {
          float holdZSpan = 1.0 / max( uMaxZ - uMinZ, 1e-4 );
          float holdHeight = ( position.z - uMinZ ) * holdZSpan;
          float holdProgress = 1.0 - fract( uHoldElapsed / max( uScanDuration, 1e-4 ) );
          float holdDelta = holdHeight - holdProgress;
          float holdBandMask = holdDelta >= 0.0
            ? 1.0 - smoothstep( 0.0, uBandWidthTrail, holdDelta )
            : 1.0 - smoothstep( 0.0, uBandWidthLead, -holdDelta );
          holdBandMask = clamp( holdBandMask, 0.0, 1.0 );
          vec3 holdViewN = normalize( normalMatrix * normal );
          float holdSideMask = smoothstep( uSideMaskMin, uSideMaskMax, abs( holdViewN.x ) )
                             * ( 1.0 - smoothstep( uFrontMaskMin, uFrontMaskMax, holdViewN.z ) );
          float holdRipple = sin( holdHeight * uRippleFreq - uHoldElapsed * uRippleSpeed );
          float holdRipple2 = sin( ( position.z ) * uRippleFreq * 0.6 - uHoldElapsed * uRippleSpeed * 0.7 );
          float holdDispMask = holdBandMask * uIsHeld;
          float holdWarpLocal = uWarpAmount * uModelScale;
          float holdRippleLocal = uRippleAmount * uModelScale;
          float holdDisplace = holdWarpLocal + holdRippleLocal * ( holdRipple * 0.5 + holdRipple2 * 0.35 );
          vec3 holdLeftObj = normalize( mat3( inverse( modelMatrix ) ) * vec3( -1.0, 0.0, 0.0 ) );
          transformed += holdLeftObj * holdDisplace * holdDispMask;
          float holdGradAxis = -holdDispMask * holdRippleLocal * 0.5 * uRippleFreq * holdZSpan
                             * cos( holdHeight * uRippleFreq - uHoldElapsed * uRippleSpeed );
          vec3 holdPerturbedObjN = normalize( normal - holdLeftObj * holdGradAxis * normal.x );
          vHoldSideMask = holdSideMask;
          vHoldSweepMask = holdBandMask;
          vHoldViewNormal = normalize( normalMatrix * holdPerturbedObjN );
        }
        `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `
        #include <common>
        uniform float uIsHeld;
        uniform float uFlux;
        uniform float uSideMaskMin;
        uniform float uSideMaskMax;
        uniform float uFrontMaskMin;
        uniform float uFrontMaskMax;
        uniform float uSpecularBoost;
        uniform float uRoughnessShift;
        uniform float uRimBoost;
        uniform float uRimPower;
        uniform float uFlareIntensity;
        uniform vec3 uGlowColor;
        uniform float uGlowStrength;
        varying float vHoldSideMask;
        varying float vHoldSweepMask;
        varying vec3 vHoldViewNormal;
        `,
      )
      .replace(
        "#include <lights_fragment_begin>",
        `
        {
          vec3 holdNV = normalize( vHoldViewNormal );
          float holdSide = smoothstep( uSideMaskMin, uSideMaskMax, abs( holdNV.x ) )
                         * ( 1.0 - smoothstep( uFrontMaskMin, uFrontMaskMax, holdNV.z ) );
          float holdActive = clamp( vHoldSweepMask * holdSide * uIsHeld, 0.0, 1.0 );
          material.roughness = max( mix( material.roughness, 0.045, holdActive * uRoughnessShift ), 0.03 );
          material.specularColor *= ( 1.0 + uSpecularBoost * holdActive );
          material.specularF90 = mix( material.specularF90, 1.0, holdActive * 0.6 );
        }
        #include <lights_fragment_begin>
        `,
      )
      .replace(
        "#include <opaque_fragment>",
        `
        {
          outgoingLight *= mix( 1.0, uFlux, uIsHeld );
          vec3 holdNV = normalize( vHoldViewNormal );
          float holdNdotV = clamp( dot( holdNV, geometryViewDir ), 0.0, 1.0 );
          float holdSide = smoothstep( uSideMaskMin, uSideMaskMax, abs( holdNV.x ) )
                         * ( 1.0 - smoothstep( uFrontMaskMin, uFrontMaskMax, holdNV.z ) );
          float holdActive = clamp( vHoldSweepMask * holdSide * uIsHeld, 0.0, 1.0 );
          float holdRim = pow( 1.0 - holdNdotV, uRimPower );
          outgoingLight += uGlowColor * uGlowStrength * uRimBoost * holdRim * holdActive;
          float holdEdge = pow( 1.0 - holdNdotV, 1.7 ) * ( 0.35 + 0.65 * holdActive );
          outgoingLight += vec3( uFlareIntensity ) * holdEdge * holdActive;
        }
        #include <opaque_fragment>
        `,
      );
  };

  material.needsUpdate = true;
  return uniforms;
}

function ResponsiveRig() {
  const { camera, gl } = useThree();
  useEffect(() => {
    camera.lookAt(0, 0, 0);
  }, [camera]);

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
  return null;
}

function Model() {
  const gltf = useLoader(GLTFLoader, MODEL_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
  const { gl } = useThree();
  const fitRef = useRef<THREE.Group>(null);
  const floatRef = useRef<THREE.Group>(null);
  const normalizedScaleRef = useRef(1);
  const floatTimeRef = useRef(0);
  const holdUniforms = useRef(createHoldUniforms());

  const { scene, bottomY } = useMemo(() => {
    const cloned = gltf.scene.clone(true);
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    cloned.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const geomMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    const geomMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (!bb) return;
      geomMin.min(bb.min);
      geomMax.max(bb.max);
    });
    holdUniforms.current.uMinZ.value = geomMin.z;
    holdUniforms.current.uMaxZ.value = geomMax.z;
    holdUniforms.current.uModelScale.value = Math.max(
      geomMax.x - geomMin.x,
      geomMax.y - geomMin.y,
      geomMax.z - geomMin.z,
      1e-4,
    );

    const patchedMaterials = new Set<THREE.Material>();
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (patchedMaterials.has(material)) return;
        patchedMaterials.add(material);
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.isMeshStandardMaterial) {
          standard.metalness = MATERIAL_METALNESS;
          standard.roughness = MATERIAL_ROUGHNESS;
        }
        holdUniforms.current = installHoldShader(material, holdUniforms.current);
      });
    });

    cloned.position.sub(center);
    cloned.rotation.y = MODEL_ROTATION_Y;
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    normalizedScaleRef.current = 1 / maxDim;
    return { scene: cloned, bottomY: -size.y / 2 / maxDim };
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        Object.values(material).forEach((value) => {
          if (value instanceof THREE.Texture) {
            value.anisotropy = maxAnisotropy;
            value.needsUpdate = true;
          }
        });
      });
    });
  }, [gltf, gl]);

  useFrame((_state, delta) => {
    const viewport = _state.viewport;
    const responsiveScale = Math.min(viewport.width, viewport.height) * VIEWPORT_FIT_FACTOR;
    fitRef.current?.scale.setScalar(normalizedScaleRef.current * responsiveScale);
    floatTimeRef.current += delta;
    if (floatRef.current) {
      floatRef.current.position.y = sampleFloatPath(floatTimeRef.current) * FLOAT_AMPLITUDE;
    }
  });

  return (
    <R3FGroup ref={fitRef}>
      <R3FGroup ref={floatRef}>
        <R3FPrimitive object={scene} />
        <ModelAccents />
      </R3FGroup>
    </R3FGroup>
  );
}

function Scene() {
  return (
    <>
      <Environment files={HDRI_URL} environmentIntensity={STUDIO_ENV_INTENSITY} />
      <R3FDirectionalLight
        position={[4.8, 4.2, 2.0]}
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
      <R3FDirectionalLight position={[-3.5, 3.2, -4.5]} intensity={0.55} color="#9aa8d0" />
      <R3FDirectionalLight position={[2.5, 4.2, -3.5]} intensity={0.8} color="#c7cbe0" />
      <R3FHemisphereLight args={["#9da8bb", "#090a0d", 0.14]} />
      <SunRimLight />
      <Suspense fallback={null}>
        <Model />
      </Suspense>
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.35} intensity={1.35} distanceFalloff={1.2} />
      </EffectComposer>
    </>
  );
}

export default function CloudscapeModel() {
  return (
    <Canvas
      className="cloudscape__model"
      shadows={{ type: THREE.PCFSoftShadowMap }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0.15, 5.8], fov: BASE_FOV, near: 0.1, far: 100 }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = STUDIO_EXPOSURE;
      }}
    >
      <ResponsiveRig />
      <Scene />
    </Canvas>
  );
}
