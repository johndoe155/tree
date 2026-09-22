/**
 * DOM side of the scenery perspective: finds the marked 2D layers, measures the
 * rest layout the perspective solver needs, and keeps it fresh across resizes
 * and the CSS breakpoints.
 *
 * Markup contract: any element (or set of elements) with
 * `data-hero-backdrop="tree" | "statue" | "background"` is a scenery layer.
 * Elements sharing an id are moved together (the sky is a shader canvas plus a
 * fallback image).
 *
 * Measuring has to happen with the intro's own transform cleared, otherwise the
 * rest rect would be read from an already-projected layer and the error would
 * compound every frame.
 */
import { useEffect, type RefObject } from "react";
import { BACKDROPS, type BackdropId } from "./config";
import type { BackdropRegistration } from "./backdropDirector";
import type { IntroHandle } from "./introHandle";

export default function BackdropRegistry({
  rootRef,
  intro,
}: {
  rootRef: RefObject<HTMLElement | null>;
  intro: IntroHandle;
}) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const measure = () => {
      const groups = new Map<BackdropId, HTMLElement[]>();
      root.querySelectorAll<HTMLElement>("[data-hero-backdrop]").forEach(element => {
        const id = element.dataset.heroBackdrop as BackdropId | undefined;
        if (!id || !(id in BACKDROPS)) return;
        const list = groups.get(id);
        if (list) list.push(element);
        else groups.set(id, [element]);
      });

      const registrations: BackdropRegistration[] = [];
      groups.forEach((elements, id) => {
        // Measure the untransformed box: the slot is the perspective handle, so
        // clear it (and the layer's own inline origin) for one frame's worth of
        // layout, then put everything back.
        const restore = elements.map(element => ({
          transform: element.style.transform,
          origin: element.style.transformOrigin,
        }));
        for (const element of elements) {
          element.style.transform = "";
          element.style.transformOrigin = "";
        }
        // The first element defines the layer: every element in a group is the
        // same box (canvas + fallback image both fill the viewport).
        const rect = elements[0].getBoundingClientRect();
        restore.forEach((state, index) => {
          elements[index].style.transform = state.transform;
          elements[index].style.transformOrigin = state.origin;
        });
        if (rect.width < 1 || rect.height < 1) return;

        registrations.push({
          id,
          elements,
          rest: {
            cx: rect.left + rect.width / 2,
            cy: rect.top + rect.height / 2,
            w: rect.width,
            h: rect.height,
          },
        });
      });

      intro.backdrops.current = registrations;
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    // Breakpoints change the island boxes without a window resize event on some
    // zoom paths; watching the layers keeps the rest rect honest.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(root);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      intro.backdrops.current = [];
    };
  }, [rootRef, intro]);

  return null;
}
