/**
 * Scroll → camera choreography + the one-shot threshold trigger.
 *
 * Lives inside the R3F canvas (mounted by <Model/>, so it only exists once the
 * GLB is on screen). Responsibilities:
 *
 *   1. read the raw scroll progress off the shared handle,
 *   2. damp it towards the target (frame-rate independent lerp),
 *   3. ease it and drive the camera position / look-at / fov,
 *   4. rotate the model wrapper on Y with the SAME eased value,
 *   5. project the door to screen space for the flash origin,
 *   6. fire the threshold trigger exactly once.
 *
 * There are no orbit/free-look controls in this scene — the camera is fully
 * story-driven — so nothing needs disabling at progress > 0.95; the `locked`
 * flag on the handle freezes scroll input for the rest of the sequence.
 *
 * No per-frame allocations: every vector/colour is a module-level scratch.
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { INTRO, MODEL_ANCHORS } from "./config";
import { clamp01 } from "./easing";
import type { IntroHandle } from "./introHandle";

const START_POSITION = new THREE.Vector3(...INTRO.camera.start.position);
const END_POSITION = new THREE.Vector3(...INTRO.camera.end.position);
const START_LOOK_AT = new THREE.Vector3(...INTRO.camera.start.lookAt);
const END_LOOK_AT = new THREE.Vector3(...INTRO.camera.end.lookAt);

/** Resting yaw of the GLB primitive after the intro has squared it up. */
const MODEL_YAW_START = 0;
const MODEL_YAW_END = (INTRO.model.squaredYawDeg * Math.PI) / 180;

// Scratch objects — reused every frame.
const _position = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _doorAnchor = new THREE.Vector3(...MODEL_ANCHORS.window);
const _doorWorld = new THREE.Vector3();
const _projected = new THREE.Vector3();

type Props = {
  intro: IntroHandle | null;
  /** Wrapper group whose `rotation.y` carries the model's rest yaw + squaring-up. */
  yawRef: React.RefObject<THREE.Object3D | null>;
};

function isPerspective(camera: THREE.Camera): camera is THREE.PerspectiveCamera {
  return (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
}

export default function IntroCameraRig({ intro, yawRef }: Props) {
  const { camera } = useThree();
  const triggeredRef = useRef(false);
  const announcedReadyRef = useRef(false);
  /** Last fov this rig wrote, so we can spot external (responsive) changes. */
  const appliedFovRef = useRef<number | null>(null);
  const baseFovRef = useRef<number>(isPerspective(camera) ? camera.fov : 32);

  // The establishing shot is also the scene's resting state; make sure the
  // camera starts there even if something else moved it before the model loaded.
  useEffect(() => {
    camera.position.copy(START_POSITION);
    camera.lookAt(START_LOOK_AT);
  }, [camera]);

  useFrame((_state, delta) => {
    if (!intro) return;

    // Let the controller know the scene can be scrubbed (first rendered frame).
    if (!announcedReadyRef.current) {
      announcedReadyRef.current = true;
      intro.reportReady();
    }

    // ---- 1/2. raw progress → damped progress ------------------------------
    // While the timeline owns the frame the target is pinned to 1 so the dolly
    // finishes its last fraction of a percent instead of stopping mid-move.
    const raw = intro.locked.current ? 1 : intro.scrollProgress.current;
    // Reduced motion gets a snappier damp: the whole sequence is compressed.
    const damping = intro.reducedMotion.current ? INTRO.scroll.reducedMotionDamping : INTRO.scroll.damping;
    const alpha = 1 - Math.pow(1 - damping, Math.min(delta, 0.1) * 60);
    const smooth = intro.smoothProgress.current + (raw - intro.smoothProgress.current) * alpha;
    intro.smoothProgress.current = smooth;

    // ---- 3. camera path ---------------------------------------------------
    const eased = INTRO.easing(clamp01(smooth));
    _position.lerpVectors(START_POSITION, END_POSITION, eased);
    _lookAt.lerpVectors(START_LOOK_AT, END_LOOK_AT, eased);
    camera.position.copy(_position);
    camera.lookAt(_lookAt);

    // Gentle fov tightening, relative to whatever the responsive rig chose.
    if (isPerspective(camera)) {
      if (appliedFovRef.current !== null && Math.abs(camera.fov - appliedFovRef.current) > 0.001) {
        // Someone else (ResponsiveRig on resize) changed fov: that becomes the base.
        baseFovRef.current = camera.fov;
      }
      const targetFov = baseFovRef.current * (1 + (INTRO.camera.endFovScale - 1) * eased);
      if (Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
      }
      appliedFovRef.current = camera.fov;
    }

    // ---- 4. model self-rotation (same eased value, one unified motion) ----
    const yawObject = yawRef.current;
    if (yawObject) {
      yawObject.rotation.y = MODEL_YAW_START + (MODEL_YAW_END - MODEL_YAW_START) * eased;
      // Refresh world matrices so the door projection below matches this frame.
      yawObject.updateWorldMatrix(true, false);
    }

    // ---- 5. door → screen space (flash origin) ---------------------------
    const doorScreen = intro.doorScreen.current;
    if (yawObject) {
      _doorWorld.copy(_doorAnchor);
      yawObject.localToWorld(_doorWorld);
      _projected.copy(_doorWorld).project(camera);
      doorScreen.x = (_projected.x + 1) / 2;
      doorScreen.y = (1 - _projected.y) / 2;
      doorScreen.visible = _projected.z < 1 && _projected.z > -1;
    }

    // ---- 6. threshold trigger (fires once per session) --------------------
    // Guarded here as well as in the controller: the scene only exists after the
    // GLB has loaded, which is exactly the gate we want for the sequence.
    if (
      !triggeredRef.current &&
      intro.phase.current === "idle" &&
      intro.ready.current &&
      intro.scrollProgress.current >= INTRO.scroll.threshold
    ) {
      triggeredRef.current = true;
      intro.fireThreshold();
    }
  });

  return null;
}
