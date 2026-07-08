import type { Zone } from "./types";

/** Color a zone by kind (support=green / resistance=red), intensity by strength. */
export function zoneColor(z: Zone, alpha = 1): string {
  const t = Math.min(Math.max(z.strength, 0), 100) / 100;
  // stronger = more saturated / opaque
  const a = (0.25 + 0.75 * t) * alpha;
  return z.kind === "support"
    ? `rgba(34, 197, 94, ${a})`
    : `rgba(239, 68, 68, ${a})`;
}

export function strengthTone(strength: number): string {
  if (strength >= 75) return "text-emerald-400";
  if (strength >= 60) return "text-lime-400";
  if (strength >= 50) return "text-amber-400";
  return "text-zinc-400";
}

export function fmt(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
