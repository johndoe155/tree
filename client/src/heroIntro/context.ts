import { createContext, useContext } from "react";
import type { IntroHandle } from "./introHandle";

/**
 * Exposed as context so CloudscapeModel (outside the R3F canvas root) and the
 * scene components inside it can all reach the same handle. The scene
 * components also receive it as an explicit prop — R3F does bridge contexts,
 * but passing it down keeps the canvas subtree self-contained.
 */
export const HeroIntroContext = createContext<IntroHandle | null>(null);

export function useIntroHandle(): IntroHandle | null {
  return useContext(HeroIntroContext);
}
