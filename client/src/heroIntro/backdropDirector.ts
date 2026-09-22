/**
 * Perspective for the 2D layers.
 *
 * The flanking islands are PNGs and the sky is a shader canvas, but they are
 * not scenery glued to the screen: each is treated as a billboard sitting on a
 * depth plane in the same world the cottage lives in, and is reprojected every
 * frame through the same camera that drives the GLB. Push the camera in and the
 * near layers grow and slide out of frame while the far ones barely move — one
 * consistent perspective instead of a 3D model moving inside a frozen poster.
 *
 * Per layer:
 *   1. at rest, the element's on-screen centre and height are solved back into a
 *      world anchor and a world height on the layer's depth plane — so progress 0
 *      reproduces the existing layout exactly (responsive breakpoints included);
 *   2. every frame the anchor is projected to screen pixels and the height that
 *      would project to the rest height is recomputed at the current depth and
 *      fov, giving the scale.
 *
 * The result is written as a single `translate3d(...) scale(...)` per element
 * with `transform-origin` on the element's own rest centre, so the transform is
 * exactly "this box, in perspective". Nothing here allocates per frame.
 */
import * as THREE from "three";
import { BACKDROPS, type BackdropId, INTRO } from "./config";

export type BackdropRest = {
  /** Rest-state centre in viewport pixels (measured with the transform cleared). */
  cx: number;
  cy: number;
  /** Rest-state size in viewport pixels. */
  w: number;
  h: number;
};

export type BackdropRegistration = {
  id: BackdropId;
  /** Every element sharing this layer (e.g. shader canvas + fallback image). */
  elements: HTMLElement[];
  rest: BackdropRest;
};

type Entry = {
  id: BackdropId;
  spec: (typeof BACKDROPS)[BackdropId];
  elements: HTMLElement[];
  rest: BackdropRest;
  /** Solved world position of the element's rest centre. */
  anchor: THREE.Vector3;
  /** Solved world height that projects to `rest.h` at rest. */
  worldHeight: number;
  /** Last transform written, so unchanged frames cost nothing. */
  applied: string;
};

type Viewport = { width: number; height: number };

/** Below this progress the layers are left exactly as the CSS laid them out. */
const REST_EPSILON = 0.0005;

export class BackdropDirector {
  private entries: Entry[] = [];
  private registrations: BackdropRegistration[] | null = null;
  private solvedFor = { restFov: 0, width: 0, height: 0 };

  // Scratch objects — reused for the life of the director.
  private readonly restCamera = new THREE.PerspectiveCamera();
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane();
  private readonly ndc = new THREE.Vector2();
  private readonly planeNormal = new THREE.Vector3(0, 0, 1);
  private readonly forward = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private dirty = true;

  /** Called by the DOM side whenever the layer set or its rest layout changes. */
  setRegistrations(registrations: BackdropRegistration[]) {
    if (registrations === this.registrations) return;
    this.registrations = registrations;
    this.dirty = true;
    for (const entry of this.entries) this.releaseTransforms(entry);
    this.entries = [];
  }

  /**
   * Reproject and reposition every layer.
   *
   * @param camera   the live scene camera (already positioned for this frame)
   * @param restFov  fov the scene sits at when progress is 0
   * @param viewport viewport size in CSS pixels. Deliberately the window size and
   *   not R3F's canvas size: these layers are DOM boxes addressed in viewport
   *   pixels, and the hero scales its canvas with CSS at some breakpoints, which
   *   would otherwise put the layers in a different coordinate space.
   */
  update(camera: THREE.PerspectiveCamera, restFov: number, viewport: Viewport, progress: number) {
    if (!this.registrations?.length) return;

    // At rest the intro applies nothing at all: no transform, no compositing
    // layer, pixel-identical to the original layout.
    if (progress <= REST_EPSILON) {
      for (const entry of this.entries) this.releaseTransforms(entry);
      return;
    }

    if (
      this.dirty ||
      this.solvedFor.restFov !== restFov ||
      this.solvedFor.width !== viewport.width ||
      this.solvedFor.height !== viewport.height
    ) {
      this.solve(restFov, viewport);
    }

    const fovRad = (camera.fov * Math.PI) / 180;
    camera.getWorldDirection(this.forward);

    for (const entry of this.entries) {
      const { rest, anchor, worldHeight, spec } = entry;

      // Anchor → screen pixels (this is the pan), with the projection including
      // the camera's own fov so a focal-length change magnifies every layer.
      this.projected.copy(anchor).project(camera);
      const screenX = ((this.projected.x + 1) / 2) * viewport.width;
      const screenY = ((1 - this.projected.y) / 2) * viewport.height;

      // Depth along the view axis drives how much the layer grows.
      const depth = Math.max(1e-3, this.probe.copy(anchor).sub(camera.position).dot(this.forward));
      const visibleWorldHeight = 2 * depth * Math.tan(fovRad / 2);
      let scale = (worldHeight / visibleWorldHeight) * (viewport.height / rest.h);

      const dx = screenX - rest.cx;
      const dy = screenY - rest.cy;

      // Sky layers must never run out of coverage as they pan.
      if (spec.coversViewport) {
        scale = Math.max(scale, 1 + (2 * Math.abs(dx)) / rest.w, 1 + (2 * Math.abs(dy)) / rest.h);
      }

      const transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
      if (transform === entry.applied) continue;
      entry.applied = transform;
      for (const element of entry.elements) {
        if (element.isConnected) element.style.transform = transform;
      }
    }
  }

  /** Drop the intro's transforms so the layers fall back to their CSS layout. */
  dispose() {
    for (const entry of this.entries) this.releaseTransforms(entry);
    this.entries = [];
    this.registrations = null;
    this.dirty = true;
  }

  private releaseTransforms(entry: Entry) {
    if (!entry.applied) return;
    entry.applied = "";
    for (const element of entry.elements) {
      if (element.isConnected) element.style.transform = "";
    }
  }

  /**
   * Solve each layer's world anchor + world height from its rest rect, using a
   * camera in the intro's rest state. The anchor is the ray through the element's
   * rest centre intersected with the layer's depth plane, so projecting it with
   * the rest camera lands exactly back on that centre.
   */
  private solve(restFov: number, viewport: Viewport) {
    this.restCamera.fov = restFov;
    this.restCamera.aspect = viewport.width / Math.max(1, viewport.height);
    this.restCamera.near = 0.1;
    this.restCamera.far = 1000;
    this.restCamera.position.set(...INTRO.camera.start.position);
    this.restCamera.lookAt(new THREE.Vector3(...INTRO.camera.start.lookAt));
    this.restCamera.updateMatrixWorld(true);
    this.restCamera.updateProjectionMatrix();
    this.restCamera.getWorldDirection(this.forward);

    const solved: Entry[] = [];
    for (const registration of this.registrations ?? []) {
      const spec = BACKDROPS[registration.id];
      const { rest } = registration;

      this.ndc.set((rest.cx / viewport.width) * 2 - 1, -((rest.cy / viewport.height) * 2 - 1));
      this.raycaster.setFromCamera(this.ndc, this.restCamera);
      this.plane.set(this.planeNormal, -spec.worldZ);

      const anchor = new THREE.Vector3(0, 0, spec.worldZ);
      if (!this.raycaster.ray.intersectPlane(this.plane, anchor)) return null;

      // World height that fills `rest.h` pixels at this anchor's view depth.
      const depth = Math.max(1e-3, this.probe.copy(anchor).sub(this.restCamera.position).dot(this.forward));
      const worldHeight = (rest.h / viewport.height) * 2 * depth * Math.tan((restFov * Math.PI) / 360);

      // Transform origin on the element's own rest centre turns the per-frame
      // transform into "this box, reprojected" with no extra offset maths.
      for (const element of registration.elements) {
        element.style.transformOrigin = `${rest.cx.toFixed(2)}px ${rest.cy.toFixed(2)}px`;
      }

      solved.push({
        id: registration.id,
        spec,
        elements: registration.elements,
        rest,
        anchor,
        worldHeight,
        applied: "",
      });
    }

    this.entries = solved;
    this.solvedFor = { restFov, width: viewport.width, height: viewport.height };
    this.dirty = false;
  }
}
