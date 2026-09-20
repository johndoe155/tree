// The filter is attached to the scene root, after the background canvas, both
// PNG islands, the GLB canvas, and the atmospheric overlay have composited.
// It is intentionally not mounted inside the R3F renderer, so it cannot alter
// the model's materials, lighting, shader uniforms, or render pipeline.
export default function SharedSceneFinish() {
  return (
    <svg
      className="cloudscape__finish-definitions"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id="cloudscape-shared-finish"
          x="-2%"
          y="-2%"
          width="104%"
          height="104%"
          colorInterpolationFilters="sRGB"
        >
          {/* A very low-level scene-wide bloom; no per-object bloom is used. */}
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation="1.15"
            result="bloomBlur"
          />
          <feColorMatrix
            in="bloomBlur"
            type="matrix"
            values="
              0.30 0.59 0.11 0 0
              0.30 0.59 0.11 0 0
              0.30 0.59 0.11 0 0
              0    0    0    0.075 0"
            result="bloom"
          />
          <feBlend
            in="SourceGraphic"
            in2="bloom"
            mode="screen"
            result="bloomedScene"
          />

          {/* Gentle toe lift and a cool-lavender grade shared by every layer. */}
          <feComponentTransfer in="bloomedScene" result="gradedScene">
            <feFuncR type="table" tableValues="0.016 1" />
            <feFuncG type="table" tableValues="0.014 0.988" />
            <feFuncB type="table" tableValues="0.026 0.982" />
          </feComponentTransfer>

          {/* One subtle grain field is blended over the final composite. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.72"
            numOctaves="2"
            seed="19"
            stitchTiles="stitch"
            result="grainSource"
          />
          <feColorMatrix
            in="grainSource"
            type="matrix"
            values="
              1 0 0 0 0
              0 1 0 0 0
              0 0 1 0 0
              0 0 0 0.032 0"
            result="grain"
          />
          <feBlend in="gradedScene" in2="grain" mode="soft-light" />
        </filter>
      </defs>
    </svg>
  );
}
