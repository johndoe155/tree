/**
 * Asset loading without Suspense, plus a diagnostics channel.
 *
 * The first version of this scene gated the whole canvas on `useLoader`, i.e. on a React Suspense
 * boundary: one asset that downloads but never settles (a decode that stalls, a texture that errors
 * inside the loader) freezes the entire frame and - because the page was fading the still photograph
 * out on a plain `requestAnimationFrame` - leaves a blank canvas where a working picture used to be.
 *
 * So assets are loaded imperatively here: every layer paints as soon as *its own* bytes are ready,
 * nothing can block anything else, and every stage is reported to the diagnostics ring buffer (see
 * `diagnostics.ts`) which the dev overlay shows and the dev server writes to a log file.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { logDiag } from "./diagnostics";

export type Asset<T> = {
  data: T | null;
  stage: "idle" | "downloading" | "decoding" | "ready" | "failed";
  detail?: string;
};

const empty = { data: null, stage: "idle" } as const;

/**
 * One request per URL, shared with the DOM layer.
 *
 * The photograph and the two island PNGs are already on the page as `<img>` elements, so they are
 * adopted rather than re-requested. That matters more than the bytes: a dev server speaks HTTP/1.1,
 * which gives a page six connections per origin, and the first version of this scene asked for the
 * same four images a second time while the .glb and the HDRI were still streaming - enough to push
 * the small requests behind tens of megabytes and make the scene look like it was never loading.
 */
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string) {
  let pending = imageCache.get(url);
  if (pending) return pending;

  pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const existing = document.querySelector<HTMLImageElement>(
      `img[src="${url}"]`
    );
    if (existing) {
      if (existing.complete && existing.naturalWidth > 0) {
        resolve(existing);
        return;
      }
      existing.addEventListener("load", () => resolve(existing), {
        once: true,
      });
      existing.addEventListener(
        "error",
        () => reject(new Error(`image failed: ${url}`)),
        {
          once: true,
        }
      );
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`image failed: ${url}`));
    image.src = url;
  });
  imageCache.set(url, pending);
  return pending;
}

/**
 * A texture from an `<img>` source (so the browser's image cache is shared with the DOM layer),
 * tagged with the colour space the scene renders in. `linearData` keeps data maps raw.
 */
export function useTexture(url: string, options?: { linearData?: boolean }) {
  const gl = useThree(state => state.gl);
  const [asset, setAsset] = useState<Asset<THREE.Texture>>(() => ({
    ...empty,
  }));

  useEffect(() => {
    let alive = true;
    setAsset({ data: null, stage: "downloading" });
    loadImage(url)
      .then(image => {
        if (!alive) return;
        setAsset({ data: null, stage: "decoding", detail: url });
        const texture = new THREE.Texture(image);
        texture.name = url;
        // sRGB sources are decoded on sample and re-encoded on output, so a plate round-trips to the
        // exact pixels the DOM layer shows. Data maps (the depth plate) must stay raw.
        texture.colorSpace = options?.linearData
          ? THREE.NoColorSpace
          : THREE.SRGBColorSpace;
        texture.anisotropy = gl.capabilities.getMaxAnisotropy();
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        setAsset({ data: texture, stage: "ready" });
      })
      .catch(error => {
        if (!alive) return;
        setAsset({ data: null, stage: "failed", detail: String(error) });
        logDiag(`texture failed ${url}: ${error}`);
      });
    return () => {
      alive = false;
    };
  }, [url, gl, options?.linearData]);

  return asset;
}

export type GltfAsset = Asset<THREE.Group> & { bytes?: number };

/**
 * The centre island. Its .glb is meshopt-compressed, so "downloaded" and "usable" are two different
 * moments: the decoder runs after the bytes arrive. Both are reported, because a stalled decode is
 * exactly the failure that used to look like a hanging page.
 */
export function useGltf(url: string) {
  const [asset, setAsset] = useState<GltfAsset>(() => ({ ...empty }));
  const progress = useRef({ loaded: 0, total: 0 });

  useEffect(() => {
    let alive = true;
    let decodedAt = 0;
    setAsset({ data: null, stage: "downloading" });
    logDiag(`gltf request ${url}`);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const stall = window.setTimeout(() => {
      if (alive && decodedAt) {
        logDiag(
          `gltf still decoding after ${url.split("/").pop()} (meshopt decoder: ${typeof MeshoptDecoder?.ready === "object" ? "wasm pending" : "ready"})`
        );
      }
    }, 20000);

    loader.load(
      url,
      gltf => {
        window.clearTimeout(stall);
        if (!alive) return;
        const scene = gltf.scene ?? gltf.scenes?.[0];
        if (!scene) {
          setAsset({ data: null, stage: "failed", detail: "no scene in gltf" });
          logDiag("gltf has no scene");
          return;
        }
        setAsset({
          data: scene,
          stage: "ready",
          bytes: progress.current.loaded,
        });
        logDiag(
          `gltf ready ${url.split("/").pop()} ${formatBytes(progress.current.loaded)}`
        );
      },
      event => {
        if (!alive) return;
        if (event.lengthComputable) {
          progress.current = { loaded: event.loaded, total: event.total };
          if (
            progress.current.total &&
            progress.current.loaded >= progress.current.total
          ) {
            decodedAt = performance.now();
            setAsset(current =>
              current.stage === "decoding"
                ? current
                : { data: null, stage: "decoding", detail: "meshopt decode" }
            );
            logDiag(`gltf downloaded ${formatBytes(event.total)}, decoding`);
          }
        }
      },
      error => {
        window.clearTimeout(stall);
        if (!alive) return;
        const detail = error instanceof Error ? error.message : String(error);
        setAsset({ data: null, stage: "failed", detail });
        logDiag(`gltf failed: ${detail}`);
      }
    );

    return () => {
      alive = false;
      window.clearTimeout(stall);
    };
  }, [url]);

  return asset;
}

/**
 * The studio HDRI, loaded and prefiltered by hand instead of through a suspending component, so
 * reflections can never hold the frame hostage. Also reports which stage it is in.
 */
export function useStudioEnvironment(url: string, intensity: number) {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const [stage, setStage] = useState<Asset<THREE.Texture>["stage"]>("idle");

  useEffect(() => {
    let alive = true;
    let texture: THREE.Texture | null = null;
    let target: THREE.WebGLRenderTarget | null = null;
    setStage("downloading");
    logDiag(`hdri request ${url.split("/").pop()}`);

    const loader = new RGBELoader();
    loader.load(
      url,
      loaded => {
        if (!alive) {
          loaded.dispose();
          return;
        }
        setStage("decoding");
        texture = loaded;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        const generator = new THREE.PMREMGenerator(gl);
        generator.compileEquirectangularShader();
        target = generator.fromEquirectangular(texture);
        generator.dispose();
        scene.environment = target.texture;
        scene.environmentIntensity = intensity;
        setStage("ready");
        logDiag(`hdri ready ${url.split("/").pop()}`);
      },
      undefined,
      error => {
        if (!alive) return;
        setStage("failed");
        logDiag(
          `hdri failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    );

    return () => {
      alive = false;
      texture?.dispose();
      target?.dispose();
      if (scene.environment === target?.texture) scene.environment = null;
    };
  }, [gl, scene, url, intensity]);

  return stage;
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)}${units[exponent]}`;
}

/** Summary for the overlay, derived from the per-layer assets. */
export function useAssetReport(
  entries: Record<string, Asset<unknown> | string>
) {
  return useMemo(
    () =>
      Object.entries(entries)
        .map(([key, value]) => {
          const stage = typeof value === "string" ? value : value.stage;
          return `${key}:${stage}`;
        })
        .join(" "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    Object.values(entries).map(value =>
      typeof value === "string" ? value : value.stage
    )
  );
}
