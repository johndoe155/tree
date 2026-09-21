/// <reference types="@react-three/fiber" />
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ATMO, INTENSITY, REDUCED_MOTION } from "@/atmosphere/config";

const R3FGroup = "group" as any;
const R3FMesh = "mesh" as any;
const R3FPointLight = "pointLight" as any;
const R3FDirectionalLight = "directionalLight" as any;
const R3FInstancedMesh = "instancedMesh" as any;

/** Local-space anchors measured from the live GLB (float-group space). */
const WINDOW = new THREE.Vector3(-0.053, 0.282, 0.243);
const LANTERN_L = new THREE.Vector3(-0.137, 0.219, 0.084);
const LANTERN_R = new THREE.Vector3(0.013, 0.214, 0.13);
const CHIMNEY = new THREE.Vector3(-0.036, 0.505, 0.106);
const WALL_N = new THREE.Vector3(-0.29, 0.0, 0.96).normalize();

function makeGlowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const cx = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / cx;
      const dy = (y - cx) / cx;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - r);
      const fall = a * a;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(fall * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const GLOW_TEX = typeof window !== "undefined" ? makeGlowTexture() : null;

function additiveMat(color: string) {
  return new THREE.MeshBasicMaterial({
    map: GLOW_TEX,
    color: new THREE.Color(color),
    blending: THREE.AdditiveBlending,
    transparent: false,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function GlowSprite({
  position,
  color,
  size,
  intensity,
}: {
  position: THREE.Vector3;
  color: string;
  size: number;
  intensity: number;
}) {
  const mat = useMemo(() => additiveMat(color), [color]);
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const pos = useMemo(() => position.clone().addScaledVector(WALL_N, 0.012), [position]);
  const meshRef = useRef<THREE.Mesh>(null);
  const base = intensity * INTENSITY;
  const camLocal = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const flicker = REDUCED_MOTION ? 1 : 0.93 + 0.07 * Math.sin(clock.elapsedTime * 2.7 + position.x * 10.0);
    mesh.scale.setScalar(size * flicker);
    (mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(base * flicker);
    mesh.updateWorldMatrix(true, false);
    camLocal.copy(camera.position);
    mesh.worldToLocal(camLocal);
    camLocal.add(mesh.position);
    mesh.lookAt(camLocal);
  });

  return (
    <R3FMesh ref={meshRef} geometry={geom} material={mat} position={pos} renderOrder={2} frustumCulled={false} />
  );
}

const SMOKE_COUNT = 18;
const _obj = new THREE.Object3D();
const _worldCam = new THREE.Vector3();
const _color = new THREE.Color();

function ChimneySmoke() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const ages = useMemo(() => {
    const a = new Float32Array(SMOKE_COUNT);
    for (let i = 0; i < SMOKE_COUNT; i++) a[i] = i / SMOKE_COUNT;
    return a;
  }, []);
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(() => additiveMat("#c8b4d4"), []);

  useFrame(({ camera }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const speed = REDUCED_MOTION ? 0 : 0.1;
    mesh.updateWorldMatrix(true, false);
    _worldCam.copy(camera.position);
    mesh.worldToLocal(_worldCam);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      ages[i] += delta * speed;
      if (ages[i] > 1) ages[i] -= 1;
      const a = ages[i];
      const x = CHIMNEY.x - a * 0.07 + Math.sin(a * 5.5 + i) * 0.01;
      const y = CHIMNEY.y + 0.018 + a * 0.14;
      const z = CHIMNEY.z + Math.cos(a * 3.8 + i) * 0.008;
      const s = 0.012 + a * 0.038;
      _obj.position.set(x, y, z);
      _obj.scale.setScalar(s);
      _obj.lookAt(_worldCam);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
      const fade = Math.sin(a * Math.PI) * 0.55;
      _color.setRGB(0.55 * fade, 0.48 * fade, 0.58 * fade);
      mesh.setColorAt(i, _color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!ATMO.life) return null;
  return (
    <R3FInstancedMesh
      ref={meshRef}
      args={[geom, mat, SMOKE_COUNT]}
      renderOrder={3}
      frustumCulled={false}
    />
  );
}

export function SunRimLight() {
  if (!ATMO.accents) return null;
  return (
    <R3FDirectionalLight
      position={[6.2, 0.35, -1.4]}
      intensity={0.22 * INTENSITY}
      color="#f0c070"
      castShadow={false}
    />
  );
}

export default function ModelAccents() {
  if (!ATMO.accents && !ATMO.life) return null;
  return (
    <R3FGroup>
      {ATMO.accents && (
        <>
          <GlowSprite position={WINDOW} color="#ffd8a8" size={0.078} intensity={0.48} />
          <GlowSprite position={LANTERN_L} color="#ffbf7a" size={0.038} intensity={0.62} />
          <GlowSprite position={LANTERN_R} color="#ffbf7a" size={0.038} intensity={0.62} />
          <R3FPointLight
            position={LANTERN_L.clone().addScaledVector(WALL_N, 0.04).toArray()}
            color="#ffb060"
            intensity={0.32 * INTENSITY}
            distance={0.5}
            decay={2}
            castShadow={false}
          />
          <R3FPointLight
            position={LANTERN_R.clone().addScaledVector(WALL_N, 0.04).toArray()}
            color="#ffb060"
            intensity={0.32 * INTENSITY}
            distance={0.5}
            decay={2}
            castShadow={false}
          />
          <R3FPointLight
            position={WINDOW.clone().addScaledVector(WALL_N, 0.03).toArray()}
            color="#ffd0a0"
            intensity={0.18 * INTENSITY}
            distance={0.38}
            decay={2}
            castShadow={false}
          />
        </>
      )}
      <ChimneySmoke />
    </R3FGroup>
  );
}
