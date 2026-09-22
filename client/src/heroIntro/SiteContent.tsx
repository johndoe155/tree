/**
 * Where the flash hands off. In a routed app this is the screen `router.push`
 * would land on; here the hero and the content share one document, so the intro
 * unmounts the hero and snaps this section into place underneath the white.
 *
 * `INTRO.reveal.selector` points at the id below — change both together.
 */
export default function SiteContent() {
  return (
    <section id="site-content" className="relative w-full bg-[#141029] text-[#efeaff]">
      <div className="pointer-events-none absolute inset-x-0 -top-40 h-40 bg-gradient-to-b from-transparent to-[#141029]" />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 py-24 sm:px-10 sm:py-32">
        <header className="flex flex-col gap-6">
          <p className="text-[11px] uppercase tracking-[0.32em] text-[#c9a8ff]/70">Above the cloud sea</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            The cottage keeps its lamp on for whoever climbs this high.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-[#cdc6e6]/80 sm:text-lg">
            Three islands drift on a warm current of air over an endless sunset. The tree island shelters
            birds that never land, the stone figure watches the horizon, and the cottage — windows lit, kettle
            on — is the only door you can knock on.
          </p>
        </header>

        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              title: "Layered atmosphere",
              body: "Depth-driven mist, drifting cloud plates and a film grain pass that keeps the sky from ever reading as a flat backdrop.",
            },
            {
              title: "One continuous camera",
              body: "The establishing shot, the dolly to the door and the light that follows are a single scroll-driven move, docked to the model's own straightening turn.",
            },
            {
              title: "Built to be re-timed",
              body: "Scroll distance, camera transforms, threshold, easing and flash timings all live in one config object.",
            },
          ].map(card => (
            <article
              key={card.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
            >
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[#ffd9a8]">
                {card.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#cdc6e6]/75">{card.body}</p>
            </article>
          ))}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-8 text-xs text-[#cdc6e6]/60">
          <span>Cloudscape — a scroll-driven hero study.</span>
          <span>Scroll back up to fly out again.</span>
        </footer>
      </div>
    </section>
  );
}
