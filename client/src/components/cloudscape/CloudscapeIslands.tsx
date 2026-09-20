import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  CENTRE_MIST,
  ISLAND_FOCUS_BLUR_PX,
  ISLAND_MIST,
  ISLAND_MIST_ALT,
  MIST_FAR_DEPTH,
  MIST_LIT_COLOR,
  MIST_NEAR_DEPTH,
  MIST_SHADOW_COLOR,
  STATUE_ISLAND,
  TREE_ISLAND,
  type MistBand,
  islandDrift,
  sideIslandOffsetPx,
  sideIslandWidthPx,
  upperAxis,
} from "./constants";
import { useTexture } from "./assets";
import { setDiagLayer } from "./diagnostics";
import {
  fitWorldSize,
  islandViewDepth,
  placeBillboard,
  viewDepthAtOrigin,
  worldUnitsPerPixel,
  type ViewportRect,
} from "./layout";
import { createIslandMaterial, createMistMaterial } from "./shaders";
import type { Director } from "./director";

type Placement = {
  object: THREE.Object3D;
  depth: number;
  rect: ViewportRect;
  rotation?: number;
};

/**
 * The two PNG islands, plus the vapour that overlaps their lower tips.
 *
 * Every quad here is billboarded and sized in CSS pixels from the same clamps the old overlay
 * layer used, so pushing an island deeper into the scene changes exactly two things: how much
 * scene fog it drinks (its atmospheric perspective) and how far out of focus it sits.
 *
 * The band that hugs the side islands lives *between* them and the centre island and is depth
 * tested against the model, which is what makes the frame read as one place: the same cloud passes
 * in front of the small islands and behind the big one.
 */
export default function CloudscapeIslands({
  director,
}: {
  director: Director;
}) {
  const tree = useTexture(TREE_ISLAND.url);
  const statue = useTexture(STATUE_ISLAND.url);
  const treeTexture = tree.data;
  const statueTexture = statue.data;

  useEffect(() => {
    const stages = [tree.stage, statue.stage];
    setDiagLayer(
      "islands",
      stages.every(stage => stage === "ready")
        ? "ready"
        : stages.some(stage => stage === "failed")
          ? "failed"
          : "loading"
    );
  }, [tree.stage, statue.stage]);

  const treeRef = useRef<THREE.Group>(null);
  const statueRef = useRef<THREE.Group>(null);
  const treeMistRef = useRef<THREE.Group>(null);
  const statueMistRef = useRef<THREE.Group>(null);
  const centreMistRefs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];

  const treeMaterial = useMemo(
    () => (treeTexture ? createIslandMaterial(treeTexture) : null),
    [treeTexture]
  );
  const statueMaterial = useMemo(
    () => (statueTexture ? createIslandMaterial(statueTexture) : null),
    [statueTexture]
  );

  const islands = useMemo(
    () => [
      {
        spec: TREE_ISLAND,
        side: -1,
        material: treeMaterial,
        mist: ISLAND_MIST,
        group: treeRef,
        mistGroup: treeMistRef,
      },
      {
        spec: STATUE_ISLAND,
        side: 1,
        material: statueMaterial,
        mist: ISLAND_MIST_ALT,
        group: statueRef,
        mistGroup: statueMistRef,
      },
    ],
    [treeMaterial, statueMaterial]
  );

  const makeMist = (band: MistBand) =>
    createMistMaterial({
      seed: band.seed,
      frequency: [band.frequency[0], band.frequency[1]],
      thinness: band.thinness,
      opacity: band.opacity,
      erosion: band.erosion,
      drift: band.drift,
      yBias: band.yBias,
      lit: new THREE.Color(MIST_LIT_COLOR),
      shadow: new THREE.Color(MIST_SHADOW_COLOR),
    });

  const bands = useMemo(
    () => [
      ...islands.map(island => ({
        ...makeMist(island.mist),
        group: island.mistGroup,
      })),
      ...CENTRE_MIST.map((band, index) => ({
        ...makeMist(band),
        group: centreMistRefs[index],
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [islands]
  );

  useFrame(state => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const size = state.size;
    const fit = fitWorldSize(
      state.viewport.width,
      state.viewport.height,
      size.width
    );
    const centreDepth = viewDepthAtOrigin(camera);
    const islandDepth = islandViewDepth(centreDepth, fit);
    const placements: Placement[] = [];

    const put = (
      object: THREE.Object3D | null,
      depth: number,
      rect: ViewportRect,
      rotation?: number
    ) => {
      if (object) placements.push({ object, depth, rect, rotation });
    };

    for (const island of islands) {
      const { spec, side, material, mist, group, mistGroup } = island;
      const widthPx = sideIslandWidthPx(spec, size.width);
      const heightPx = (widthPx * spec.sourceHeight) / spec.sourceWidth;
      const offsetPx = sideIslandOffsetPx(spec, size.width);
      const drift = islandDrift(spec, director.time);

      const rect: ViewportRect = {
        x: side < 0 ? offsetPx : size.width - offsetPx - widthPx,
        // `upperAxis` is where the top edge of the image box sits, which is how the layer actually
        // composed in the browser (the float keyframes replaced the -50% translate).
        y:
          upperAxis(size.width) * size.height + drift.offsetY * director.motion,
        width: widthPx,
        height: heightPx,
      };
      put(group.current, islandDepth, rect, drift.rotation * director.motion);

      // The defocus is authored in screen pixels and converted into the plate's uv space, so the
      // islands stay this soft whether they render 180px or 340px wide.
      material?.userData.blur.value.set(
        ISLAND_FOCUS_BLUR_PX / widthPx,
        ISLAND_FOCUS_BLUR_PX / heightPx
      );

      const bandWidth = mist.widthFactor * widthPx;
      const bandHeight = mist.heightFactor * widthPx;
      put(mistGroup.current, centreDepth + MIST_FAR_DEPTH * fit, {
        x:
          rect.x + spec.tipX * widthPx - bandWidth / 2 + mist.offsetX * widthPx,
        y:
          rect.y +
          spec.tipY * heightPx -
          bandHeight / 2 +
          mist.offsetY * widthPx +
          drift.offsetY * mist.follow * director.motion,
        width: bandWidth,
        height: bandHeight,
      });
    }

    // Wisps in front of the centre island: anchored to its own fitted box, which lives in world
    // units, so the size is converted back to pixels before the rect is built.
    const centreFitPx =
      fit / worldUnitsPerPixel(camera, centreDepth, size.height);
    CENTRE_MIST.forEach((band, index) => {
      const width = band.widthFactor * centreFitPx;
      const height = band.heightFactor * centreFitPx;
      put(centreMistRefs[index].current, centreDepth + MIST_NEAR_DEPTH * fit, {
        x: band.anchorX * size.width - width / 2,
        y: size.height / 2 + band.anchorY * centreFitPx - height / 2,
        width,
        height,
      });
    });

    for (const placement of placements) {
      placeBillboard(
        placement.object,
        camera,
        size,
        placement.depth,
        placement.rect
      );
      if (placement.rotation) placement.object.rotateZ(placement.rotation);
    }

    for (const band of bands) {
      band.uniforms.uTime.value = director.time;
      band.uniforms.uReducedMotion.value = director.reducedMotion;
    }
  });

  return (
    <>
      {islands.map((island, index) => (
        <group key={`island-${index}`} ref={island.group} renderOrder={2}>
          {island.material ? (
            <mesh material={island.material} frustumCulled={false}>
              <planeGeometry args={[1, 1]} />
            </mesh>
          ) : null}
        </group>
      ))}
      {bands.map((band, index) => (
        <group
          key={`band-${index}`}
          ref={band.group}
          renderOrder={index < islands.length ? 3 : 4}
        >
          <mesh material={band.material} frustumCulled={false}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        </group>
      ))}
    </>
  );
}
