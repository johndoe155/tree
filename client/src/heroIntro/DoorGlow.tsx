/**
 * The door light: what Step 3 of the sequence turns up.
 *
 * Three additive quads sit on the cottage wall (the round window pane, a soft
 * halo around it, and the light spilling from the doorway) plus a point light
 * that lifts the surrounding plaster. Everything is driven by the shared
 * `glowLevel` cell, which the flash timeline writes — so the ramp is purely
 * time-based and cannot be scrubbed or reversed by the scroll wheel.
 *
 * The quads are parented to a group aligned with the measured wall plane, so
 * they stay glued to the surface while the model squares itself up.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { INTRO, MODEL_ANCHORS } from "./config";
import { createGlowTexture } from "./glowTexture";
import type { IntroHandle } from "./introHandle";

const WALL_NORMAL = new THREE.Vector3(...MODEL_ANCHORS.wallNormal).normalize();
/** Wall plane sits at this yaw inside the model's own space. */
const WALL_YAW = Math.atan2(WALL_NORMAL.x, WALL_NORMAL.z);
/** Lift the quads off the plaster just enough to avoid z-fighting. */
const SURFACE_OFFSET = 0.004;

const HALO_COLOUR = new THREE.Color(INTRO.glow.color);
const CORE_COLOUR = new THREE.Color(INTRO.glow.coreColor);
const _colour = new THREE.Color();

const WINDOW = MODEL_ANCHORS.window;
const DOOR = MODEL_ANCHORS.door;
/** Door, expressed relative to the window group's origin. */
const DOOR_OFFSET: [number, number, number] = [DOOR[0] - WINDOW[0], DOOR[1] - WINDOW[1], DOOR[2] - WINDOW[2]];

type Props = { intro: IntroHandle | null };

export default function DoorGlow({ intro }: Props) {
  const texture = useMemo(() => createGlowTexture(), []);
  const haloRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  const haloMaterial = useMemo(() => makeAdditiveMaterial(texture, INTRO.glow.color), [texture]);
  const coreMaterial = useMemo(() => makeAdditiveMaterial(texture, INTRO.glow.coreColor), [texture]);
  const doorMaterial = useMemo(() => makeAdditiveMaterial(texture, INTRO.glow.color), [texture]);

  useEffect(
    () => () => {
      texture.dispose();
      haloMaterial.dispose();
      coreMaterial.dispose();
      doorMaterial.dispose();
    },
    [texture, haloMaterial, coreMaterial, doorMaterial]
  );

  useFrame(() => {
    if (!intro) return;
    const group = groupRef.current;
    if (!group) return;

    const level = intro.glowLevel.current;
    const flash = intro.flashLevel.current;

    // Nothing to draw (and nothing to pay for) until the glow starts.
    group.visible = level > 0.001;
    if (!group.visible) return;

    // The halo keeps swelling while the white flash expands, so the last thing
    // the eye tracks is light coming out of the door — not a flat wipe.
    const bloom = 1 + flash * INTRO.glow.bloomGrowth;

    const halo = haloRef.current;
    if (halo) {
      halo.scale.setScalar(INTRO.glow.haloSize * bloom);
      _colour.copy(HALO_COLOUR).multiplyScalar(level * INTRO.glow.haloIntensity * (1 + flash * 1.4));
      haloMaterial.color.copy(_colour);
    }

    _colour.copy(CORE_COLOUR).multiplyScalar(Math.min(1, level * 0.9 * (1 + flash)));
    coreMaterial.color.copy(_colour);

    _colour.copy(HALO_COLOUR).multiplyScalar(level * 0.6 * (1 + flash));
    doorMaterial.color.copy(_colour);

    const light = lightRef.current;
    if (light) {
      light.intensity = level * INTRO.glow.lightIntensity * (1 + flash * 0.8);
    }
  });

  return (
    <group
      ref={groupRef}
      position={[
        WINDOW[0] + WALL_NORMAL.x * SURFACE_OFFSET,
        WINDOW[1],
        WINDOW[2] + WALL_NORMAL.z * SURFACE_OFFSET,
      ]}
      rotation={[0, WALL_YAW, 0]}
      visible={false}
    >
      {/* Round window pane: the light itself. */}
      <mesh material={coreMaterial} position={[0, 0, 0.004]} renderOrder={4}>
        <planeGeometry args={[INTRO.glow.coreSize, INTRO.glow.coreSize]} />
      </mesh>
      {/* Soft halo around the pane, scaled per frame. */}
      <mesh ref={haloRef} material={haloMaterial} position={[0, 0, 0.008]} renderOrder={3}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {/* Light escaping around the door slab, expressed relative to the pane. */}
      <mesh material={doorMaterial} position={DOOR_OFFSET} renderOrder={3}>
        <planeGeometry args={[INTRO.glow.doorSize, INTRO.glow.doorSize * 1.45]} />
      </mesh>
      <pointLight
        ref={lightRef}
        position={[
          DOOR_OFFSET[0] + WALL_NORMAL.x * 0.05,
          DOOR_OFFSET[1],
          DOOR_OFFSET[2] + WALL_NORMAL.z * 0.05,
        ]}
        color={INTRO.glow.color}
        intensity={0}
        distance={INTRO.glow.lightDistance}
        decay={2}
        castShadow={false}
      />
    </group>
  );
}

/**
 * Additive `MeshBasicMaterial` without `transparent: true`, matching the rest
 * of the scene's glow sprites so the AO pass keeps its opaque depth path.
 * Brightness is carried entirely by the colour, which the frame loop ramps.
 */
function makeAdditiveMaterial(texture: THREE.Texture, color: string) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    color: new THREE.Color(color),
    blending: THREE.AdditiveBlending,
    transparent: false,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}
