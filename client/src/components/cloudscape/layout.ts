import * as THREE from "three";
import {
  FOG_NEAR_OFFSET,
  FOG_SPAN_FACTOR,
  ISLAND_VIEW_DEPTH,
  VIEWPORT_FIT_FACTOR,
  centerScale,
} from "./constants";

/**
 * Screen-space layout for billboarded layers.
 *
 * The PNG islands, the mist and the sky are all quads that face the camera. Sizing them in
 * view space (instead of world space) means a layer keeps its intended *pixel* footprint no
 * matter which depth it sits at, so pushing it back only changes its fog and its parallax.
 */

export type ViewportRect = {
  /** Top-left origin, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
};

const _origin = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();

/**
 * View-space depth of the world origin, which is where the centre island sits. Everything that
 * depends on "how far away am I" is measured this way so the fog and the layers agree.
 */
export function viewDepthAtOrigin(camera: THREE.Camera) {
  camera.updateMatrixWorld();
  return -_origin.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse).z;
}

/** World size of one CSS pixel at a given distance down the view axis. */
export function worldUnitsPerPixel(
  camera: THREE.PerspectiveCamera,
  viewDepth: number,
  heightPx: number
) {
  const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * viewDepth;
  return viewHeight / heightPx;
}

/**
 * Writes the transform that makes `object` occupy `rect` on screen while sitting
 * `viewDepth` units in front of the camera, facing it exactly.
 */
export function placeBillboard(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  size: { width: number; height: number },
  viewDepth: number,
  rect: ViewportRect
) {
  camera.updateMatrixWorld();
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);
  _forward.setFromMatrixColumn(camera.matrixWorld, 2).negate();

  const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * viewDepth;
  const viewWidth = viewHeight * (size.width / size.height);
  const perPx = viewHeight / size.height;

  const centreX = (rect.x + rect.width / 2) / size.width;
  const centreY = (rect.y + rect.height / 2) / size.height;
  const ndcX = centreX * 2 - 1;
  const ndcY = 1 - centreY * 2;

  object.position
    .copy(camera.position)
    .addScaledVector(_right, (ndcX * viewWidth) / 2)
    .addScaledVector(_up, (ndcY * viewHeight) / 2)
    .addScaledVector(_forward, viewDepth);
  object.quaternion.copy(camera.quaternion);
  object.scale.set(rect.width * perPx, rect.height * perPx, 1);
}

/** World size of the centre island for the current viewport, including the mobile shrink. */
export function fitWorldSize(
  viewportWidth: number,
  viewportHeight: number,
  widthPx: number
) {
  return (
    Math.min(viewportWidth, viewportHeight) *
    VIEWPORT_FIT_FACTOR *
    centerScale(widthPx)
  );
}

/**
 * Linear fog tuned off the fitted scene size, so the ramp stays the same on a phone and on a
 * 5K display. The centre island's lit face stays inside `near` (no fog at all) and only its
 * receding side, the PNG islands and the far mist pick up atmosphere.
 */
export function fogRangeFor(viewDepthAtCentre: number, fit: number) {
  const near = viewDepthAtCentre + FOG_NEAR_OFFSET * fit;
  return { near, far: near + FOG_SPAN_FACTOR * fit };
}

/** View-space depth of the PNG islands. */
export const islandViewDepth = (viewDepthAtCentre: number, fit: number) =>
  viewDepthAtCentre + ISLAND_VIEW_DEPTH * fit;
