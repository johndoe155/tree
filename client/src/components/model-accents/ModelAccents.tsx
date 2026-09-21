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

function hash21(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise2(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm2(x: number, y: number) {
  let v = 0;
  let a = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    v += a * noise2(px, py);
    px = px * 2.03 + 17.1;
    py = py * 2.03 + 9.4;
    a *= 0.5;
  }
  return v;
}

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

function makeSmokeTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const cx = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / cx;
      const dy = (y - cx) / cx;
      const r = Math.sqrt(dx * dx + dy * dy);
      const envelope = Math.max(0, 1 - r);
      const n = fbm2(x * 0.07, y * 0.07);
      const fall = Math.pow(envelope, 1.8) * (0.18 + 0.45 * n);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, fall) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const GLOW_TEX = typeof window !== "undefined" ? makeGlowTexture() : null;
const SMOKE_TEX = typeof window !== "undefined" ? makeSmokeTexture() : null;

function additiveMat(color: string, map: THREE.DataTexture | null = GLOW_TEX) {
  return new THREE.MeshBasicMaterial({
    map,
    color: new THREE.Color(color),
    blending: THREE.AdditiveBlending,
    transparent: false,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/** Alpha-blended smoke without `transparent: true` (keeps N8AO on its opaque path). */
function smokeMat() {
  return new THREE.MeshBasicMaterial({
    map: SMOKE_TEX,
    color: new THREE.Color("#c9a3c4"),
    vertexColors: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    transparent: false,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    opacity: 1,
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

const SMOKE_COUNT = 28;
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
  const seeds = useMemo(() => {
    const s = new Float32Array(SMOKE_COUNT * 3);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      s[i * 3] = (hash21(i, 1.7) - 0.5) * 2;
      s[i * 3 + 1] = 0.7 + hash21(i, 4.2) * 0.8;
      s[i * 3 + 2] = hash21(i, 9.1);
    }
    return s;
  }, []);
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(() => smokeMat(), []);

  useFrame(({ camera }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const speed = REDUCED_MOTION ? 0 : 0.08;
    mesh.updateWorldMatrix(true, false);
    _worldCam.copy(camera.position);
    mesh.worldToLocal(_worldCam);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const sx = seeds[i * 3];
      const sy = seeds[i * 3 + 1];
      const sz = seeds[i * 3 + 2];
      ages[i] += delta * speed * sy;
      if (ages[i] > 1) ages[i] -= 1;
      const a = ages[i];
      const swirl = a * 3.4 + i * 0.35;
      const x = CHIMNEY.x - a * 0.11 + Math.sin(swirl) * (0.016 + a * 0.04) * sx;
      const y = CHIMNEY.y + 0.01 + a * 0.28 * sy;
      const z = CHIMNEY.z + Math.cos(swirl * 0.8) * (0.012 + a * 0.03);
      const s = (0.055 + a * 0.16 * sy) * (0.9 + sz * 0.35);
      _obj.position.set(x, y, z);
      _obj.scale.set(s * 1.25, s, s);
      _obj.lookAt(_worldCam);
      _obj.rotateZ(sz * 6.28 + a * 0.7);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
      const fade = Math.pow(1.0 - a, 0.45) * (a < 0.06 ? a / 0.06 : 1);
      _color.setRGB(0.95 * fade, 0.78 * fade, 0.88 * fade);
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

function HouseRockMist() {
  const mat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: SMOKE_TEX,
      color: new THREE.Color("#d2a8c8"),
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      transparent: false,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    return m;
  }, []);
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = REDUCED_MOTION ? 0 : clock.elapsedTime;
    mesh.scale.set(0.55 + Math.sin(t * 0.15) * 0.03, 0.28, 1);
  });
  return (
    <R3FMesh
      ref={meshRef}
      geometry={geom}
      material={mat}
      position={[0.02, -0.32, 0.12]}
      renderOrder={1}
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
