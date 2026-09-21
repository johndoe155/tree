import { ATMO } from "./config";

export default function FilmGrain() {
  if (!ATMO.enabled || !ATMO.grain) return null;
  return <div className="cloudscape__grain" aria-hidden="true" />;
}
