/** Feature flags for the additive atmosphere stack.
 *  URL overrides: ?atmo=0 disables everything; ?mist=0, ?life=0, ?accents=0,
 *  ?grain=0, ?rays=0, ?vignette=0, ?fg=0 turn individual pieces off.
 *  These never touch the background shader or the model materials. */

function urlFlag(name: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = new URLSearchParams(window.location.search).get(name);
    if (v === null) return fallback;
    return !(v === "0" || v === "false" || v === "off");
  } catch {
    return fallback;
  }
}

const atmoMaster = urlFlag("atmo", true);

export const ATMO = {
  enabled: atmoMaster,
  mist: atmoMaster && urlFlag("mist", true),
  life: atmoMaster && urlFlag("life", true),
  accents: atmoMaster && urlFlag("accents", true),
  grain: atmoMaster && urlFlag("grain", true),
  rays: atmoMaster && urlFlag("rays", true),
  vignette: atmoMaster && urlFlag("vignette", true),
  foreground: atmoMaster && urlFlag("fg", true),
  sunGlow: atmoMaster && urlFlag("sunglow", true),
} as const;

export const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const IS_MOBILE =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 767px)").matches);

/** Subtle intensity scale. All shader uniforms are multiplied by this. */
export const INTENSITY = 0.72;
