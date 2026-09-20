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
import { PMREMGenerator } from "three/src/extras/PMREMGenerator.js";
import { SRGBColorSpace } from "three/src/constants.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { downloadInChunks } from "./chunk-download";
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
    let decoding = false;
    let bytes = 0;
    let total = 0;
    setAsset({ data: null, stage: "downloading" });
    logDiag(`gltf request ${url}`);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    // This .glb stores its geometry with EXT_meshopt_compression, so it only decodes through the
    // meshopt WASM decoder. If the page cannot instantiate that wasm — a Content-Security-Policy on
    // whatever host is serving the preview is enough — the loader waits forever and the centre
    // island never turns up, with nothing at all in the console. That is exactly the failure being
    // reported, so ask the decoder directly and say which way it answered.
    void Promise.resolve(MeshoptDecoder?.ready)
      .then(() => logDiag("meshopt decoder ready"))
      .catch(error =>
        logDiag(
          `meshopt decoder REFUSED: ${error instanceof Error ? error.message : String(error)}`
        )
      );

    const ticker = window.setInterval(() => {
      if (!alive) return;
      logDiag(
        decoding
          ? `gltf still decoding (${formatBytes(bytes)} received)`
          : `gltf still transferring ${formatBytes(bytes)}${total ? ` of ${formatBytes(total)}` : ""}`
      );
    }, 4000);
    const watchdog = window.setTimeout(() => {
      if (!alive) return;
      logDiag(
        `gltf watchdog: ${decoding ? "decoder still running" : "transfer still open"} after 30s, ${formatBytes(bytes)} in`
      );
    }, 30000);
    const stop = () => {
      window.clearInterval(ticker);
      window.clearTimeout(watchdog);
    };

    // Fetched in ranged pieces and reassembled, then handed to GLTFLoader.parse, instead of one long
    // stream. A proxied dev server is where a 50MB response tends to die quietly mid-flight, and a
    // dropped piece can be retried while a truncated single request cannot.
    downloadInChunks(
      url,
      (received, size) => {
        bytes = received;
        total = size;
        progress.current = { loaded: received, total: size };
        if (size > 0 && received >= size && !decoding) {
          decoding = true;
          setAsset(current =>
            current.stage === "decoding"
              ? current
              : { data: null, stage: "decoding", detail: "meshopt decode" }
          );
          logDiag(`gltf transferred ${formatBytes(size)}, decoding`);
        }
      },
      note => logDiag(`gltf ${note}`)
    )
      .then(buffer => {
        stop();
        if (!alive) return;
        const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
        if (magic !== "glTF") {
          // A dev server answers unknown paths with index.html, and that would otherwise surface as
          // "this is not a GLB file" with no hint that the asset is simply not where it was asked for.
          throw new Error(
            `not a glb (server answered "${magic}", ${buffer.byteLength} bytes) — is the file in client/public?`
          );
        }
        loader.parse(
          buffer,
          "",
          gltf => {
            if (!alive) return;
            const scene = gltf.scene ?? gltf.scenes?.[0];
            if (!scene) {
              setAsset({
                data: null,
                stage: "failed",
                detail: "no scene in gltf",
              });
              logDiag("gltf has no scene");
              return;
            }
            setAsset({
              data: scene,
              stage: "ready",
              bytes: progress.current.loaded,
            });
            logDiag(
              `gltf ready at ${formatBytes(progress.current.loaded)} of ${formatBytes(total)}`
            );
          },
          error => {
            const detail =
              error instanceof Error ? error.message : String(error);
            setAsset({ data: null, stage: "failed", detail });
            logDiag(`gltf parse failed: ${detail}`);
          }
        );
      })
      .catch(error => {
        stop();
        if (!alive) return;
        const detail = error instanceof Error ? error.message : String(error);
        setAsset({ data: null, stage: "failed", detail });
        logDiag(`gltf failed: ${detail}`);
      });

    return () => {
      alive = false;
      stop();
    };
  }, [url]);

  return { ...asset, progress };
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
/**
 * The studio HDRIL environment, applied without drei's <Environment>: the light rig is what makes the
 * island read as a physical object, and its reflections genuinely depend on the model being in the
 * room, so it loads together with the model rather than as part of the always-visible background.
 *
 * A WebGLCubeUVMaps-style prefiltered environment is what three's physical materials actually sample;
 * PMREMGenerator produces the equivalent from an .hdr, and `scene.environmentIntensity` replaces the
 * legacy `combine: operation` maths that was removed from three.
 */
export function useStudioEnvironment(
  url: string,
  intensity: number
): "loading" | "ready" | "failed" {
  const scene = useThree(state => state.scene);
  const gl = useThree(state => state.gl);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  );

  useEffect(() => {
    let disposed = false;
    setStatus("loading");
    let texture: THREE.Texture | null = null;
    let pmrem: PMREMGenerator | null = null;

    const restore = () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
    };

    // Deliberately one plain request: a 23MB .hdr parsed by HDRLoader yields raw image data, so
    // reassembling it in slices would mean reconstructing the DataTexture by hand. Its failure mode
    // is loud instead — the loader reports the error and the layer below says so.
    new RGBELoader().load(
      url,
      hdr => {
        if (disposed) {
          hdr.dispose();
          return;
        }
        try {
          hdr.mapping = THREE.EquirectangularReflectionMapping;
          hdr.colorSpace = SRGBColorSpace;
          pmrem = new PMREMGenerator(gl);
          pmrem.compileEquirectangularShader();
          texture = pmrem.fromEquirectangular(hdr).texture;
          scene.environment = texture;
          scene.environmentIntensity = intensity;
          setStatus("ready");
          logDiag("env ready: prefiltered radiance map applied");
        } catch (error) {
          setStatus("failed");
          logDiag(
            `env failed: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          hdr.dispose();
          pmrem?.dispose();
          pmrem = null;
        }
      },
      undefined,
      error => {
        if (disposed) return;
        setStatus("failed");
        logDiag(
          `env failed: ${error instanceof Error ? error.message : String(error) || "request error"}`
        );
      }
    );

    return () => {
      disposed = true;
      restore();
      texture?.dispose();
      pmrem?.dispose();
    };
  }, [scene, gl, url, intensity, setStatus]);

  return status;
}

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
