import { CONFIG } from "./config";
import type { Candle, VolumeProfile } from "./types";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

export function buildProfile(
  candles: Candle[],
  bins = CONFIG.profileBins,
): VolumeProfile {
  const lo = Math.min(...candles.map((c) => c.low));
  let hi = Math.max(...candles.map((c) => c.high));
  if (hi <= lo) hi = lo * 1.001;

  const binW = (hi - lo) / bins;
  const centers: number[] = Array.from(
    { length: bins },
    (_, i) => lo + binW * (i + 0.5),
  );
  const vol = new Array(bins).fill(0);

  // Spread each candle's volume across the bins its range covered.
  for (const c of candles) {
    if (c.volume <= 0) continue;
    const span = Math.max(c.high - c.low, binW);
    const first = clamp(Math.floor((c.low - lo) / binW), 0, bins - 1);
    const last = clamp(Math.floor((c.high - lo) / binW), 0, bins - 1);
    const n = last - first + 1;
    const per = (c.volume / n) * ((binW * n) / span);
    for (let i = first; i <= last; i++) vol[i] += per;
  }

  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;
  const poc = centers[pocIdx];

  // Value area: expand from POC until 70% of volume captured.
  const total = vol.reduce((a, b) => a + b, 0);
  const target = total * CONFIG.valueAreaPct;
  let loI = pocIdx;
  let hiI = pocIdx;
  let captured = vol[pocIdx];
  while (captured < target && (loI > 0 || hiI < bins - 1)) {
    const lowV = loI > 0 ? vol[loI - 1] : -1;
    const highV = hiI < bins - 1 ? vol[hiI + 1] : -1;
    if (highV >= lowV) captured += vol[++hiI];
    else captured += vol[--loI];
  }

  const vmax = Math.max(...vol) || 1;
  const hvns: number[] = [];
  const lvns: number[] = [];
  for (let i = 1; i < bins - 1; i++) {
    if (
      vol[i] > vol[i - 1] &&
      vol[i] >= vol[i + 1] &&
      vol[i] >= CONFIG.hvnProminence * vmax
    )
      hvns.push(centers[i]);
    if (
      vol[i] < vol[i - 1] &&
      vol[i] <= vol[i + 1] &&
      vol[i] <= (1 - CONFIG.hvnProminence) * vmax
    )
      lvns.push(centers[i]);
  }

  return { prices: centers, volume: vol, poc, vah: centers[hiI], val: centers[loI], hvns, lvns };
}

export function volumeAtPrice(profile: VolumeProfile, price: number): number {
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < profile.prices.length; i++) {
    const d = Math.abs(profile.prices[i] - price);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  const vmax = Math.max(...profile.volume) || 1;
  return profile.volume[idx] / vmax;
}
