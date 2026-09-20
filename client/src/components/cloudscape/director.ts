import * as THREE from "three";

/**
 * Frame state shared by every layer in the scene.
 *
 * One clock for the sky plate, the islands, their mist and the post-process finish, so nothing in
 * the frame drifts at its own rate (the old split between a DOM layer and a canvas meant they did).
 */
export type Director = {
  /** Seconds since the scene came up. */
  time: number;
  /** 1 normally, 0 when the visitor asked for reduced motion: freezes every drift. */
  motion: number;
  reducedMotion: number;
  /** Normalised pointer, -1..1, used for the plate's parallax. */
  pointer: THREE.Vector2;
};

export function createDirector(): Director {
  return {
    time: 0,
    motion: 1,
    reducedMotion: 0,
    pointer: new THREE.Vector2(),
  };
}
