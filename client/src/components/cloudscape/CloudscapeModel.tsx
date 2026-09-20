/// <reference types="@react-three/fiber" />
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  FLOAT_AMPLITUDE_BASE,
  FLOAT_SPEED,
  MODEL_URL,
  MODEL_ROTATION_Y,
  VIEWPORT_FIT_FACTOR,
  centerScale,
} from "./constants";
import { useGltf } from "./assets";
import { setDiagLayer } from "./diagnostics";
import type { Director } from "./director";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FLOAT_AMPLITUDE = REDUCED_MOTION ? 0 : FLOAT_AMPLITUDE_BASE;
/** Seconds the centre island takes to grow to full size once its bytes are decoded. */
const SETTLE_SECONDS = 0.5;

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

// Material feel. Both values are multiplied with the model's metallic/roughness
// texture at render time, so the .glb itself is untouched.
const MATERIAL_METALNESS = 0.05; // 0 = never metallic
const MATERIAL_ROUGHNESS = 1.5; // >1 pushes rougher (final value caps at 1)

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

/**
 * The hold shader is written on top of the model's own PBR program, so the material keeps every
 * other chunk three.js gives it - including `<fog_fragment>`. That is what lets the centre island
 * pick up a touch of atmosphere on the side that faces away from the camera without anyone
 * hand-painting it.
 */
function installHoldShader(
  material: THREE.Material,
  uniforms: ReturnType<typeof createHoldUniforms>
) {
  if (material.userData.holdUniforms) return material.userData.holdUniforms;
  material.userData.holdUniforms = uniforms;

  material.onBeforeCompile = shader => {
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
        `
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
        `
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
        `
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
        `
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
        `
      );
  };

  material.needsUpdate = true;
  return uniforms;
}

export default function CloudscapeModel({ director }: { director: Director }) {
  const gltf = useGltf(MODEL_URL);
  const gl = useThree(state => state.gl);
  const settleRef = useRef(REDUCED_MOTION ? 1 : 0);

  useEffect(() => {
    setDiagLayer("model", gltf.data ? "ready" : gltf.stage);
  }, [gltf.data, gltf.stage]);
  const fitRef = useRef<THREE.Group>(null);
  const floatRef = useRef<THREE.Group>(null);
  const normalizedScaleRef = useRef(1);
  const holdUniforms = useRef(createHoldUniforms());

  const { scene } = useMemo(() => {
    if (!gltf.data) return { scene: null as THREE.Group | null };
    const cloned = gltf.data.clone(true);
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
    const patchedMaterials = new Set<THREE.Material>();
    let geomMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    let geomMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    cloned.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.geometry || !mesh.material) return;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (bb) {
        geomMin = geomMin.min(bb.min);
        geomMax = geomMax.max(bb.max);
      }
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach(material => {
        if (patchedMaterials.has(material)) return;
        patchedMaterials.add(material);
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.isMeshStandardMaterial) {
          standard.metalness = MATERIAL_METALNESS;
          standard.roughness = MATERIAL_ROUGHNESS;
        }
        // Keep the plate textures crisp at grazing angles: anisotropic filtering is what stops
        // the model's own surfaces from smearing while the islands around them stay sharp.
        Object.values(material).forEach(value => {
          if (value instanceof THREE.Texture) {
            value.anisotropy = maxAnisotropy;
            value.needsUpdate = true;
          }
        });
        holdUniforms.current = installHoldShader(
          material,
          holdUniforms.current
        );
      });
    });

    holdUniforms.current.uMinZ.value = geomMin.z;
    holdUniforms.current.uMaxZ.value = geomMax.z;
    holdUniforms.current.uModelScale.value = Math.max(
      geomMax.x - geomMin.x,
      geomMax.y - geomMin.y,
      geomMax.z - geomMin.z,
      1e-4
    );

    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    cloned.position.sub(center);
    cloned.rotation.y = MODEL_ROTATION_Y;
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    normalizedScaleRef.current = 1 / maxDim;
    return { scene: cloned };
  }, [gltf.data, gl]);

  useFrame((state, delta) => {
    const viewport = state.viewport;
    // The model is the last thing to arrive, so it grows the last 3% instead of appearing as a pop
    // in the middle of an already-moving frame.
    if (settleRef.current < 1) {
      settleRef.current = Math.min(
        1,
        settleRef.current + delta / SETTLE_SECONDS
      );
    }
    const settle = 0.97 + 0.03 * (1 - Math.pow(1 - settleRef.current, 3));
    // `centerScale` used to shrink the whole canvas from CSS; now that the canvas also carries the
    // sky, only the centre island scales down on small screens.
    const responsive =
      Math.min(viewport.width, viewport.height) *
      VIEWPORT_FIT_FACTOR *
      centerScale(state.size.width);
    fitRef.current?.scale.setScalar(
      normalizedScaleRef.current * responsive * settle
    );
    if (floatRef.current) {
      floatRef.current.position.y =
        sampleFloatPath(director.time) * FLOAT_AMPLITUDE;
    }
  });

  if (!scene) return null;

  return (
    <group ref={fitRef}>
      <group ref={floatRef}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
