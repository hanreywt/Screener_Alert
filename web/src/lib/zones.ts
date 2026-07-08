import { CONFIG } from "./config";
import { volumeAtPrice } from "./volumeProfile";
import type { Candle, VolumeProfile, Zone } from "./types";

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

interface Candidate {
  price: number;
  time: number | null; // null for volume-node seeds
  source: string; // "pivot" | POC | VAH | VAL | HVN
}

function swingPivots(candles: Candle[], k: number) {
  const highs: { time: number; price: number }[] = [];
  const lows: { time: number; price: number }[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ time: candles[i].time, price: candles[i].high });
    if (isLow) lows.push({ time: candles[i].time, price: candles[i].low });
  }
  return { highs, lows };
}

function rejectionAt(
  candles: Candle[],
  lo: number,
  hi: number,
  atr: number,
): number {
  const rej: number[] = [];
  for (const c of candles) {
    if (c.low <= hi && c.high >= lo) {
      const bodyHi = Math.max(c.open, c.close);
      const bodyLo = Math.min(c.open, c.close);
      rej.push(Math.max(c.high - bodyHi, bodyLo - c.low));
    }
  }
  if (!rej.length || atr <= 0) return 0;
  return clamp01(mean(rej) / atr);
}

export function detectZones(
  candles: Candle[],
  profile: VolumeProfile,
  atr: number,
  price: number,
): Zone[] {
  const { highs, lows } = swingPivots(candles, CONFIG.pivotLookback);
  const cands: Candidate[] = [];
  for (const h of highs) cands.push({ price: h.price, time: h.time, source: "pivot" });
  for (const l of lows) cands.push({ price: l.price, time: l.time, source: "pivot" });
  cands.push({ price: profile.poc, time: null, source: "POC" });
  cands.push({ price: profile.vah, time: null, source: "VAH" });
  cands.push({ price: profile.val, time: null, source: "VAL" });
  for (const p of profile.hvns) cands.push({ price: p, time: null, source: "HVN" });

  cands.sort((a, b) => a.price - b.price);
  const tol = CONFIG.clusterAtrMult * atr;

  // Agglomerate candidates within `tol` of the running cluster mean.
  const clusters: Candidate[][] = [];
  for (const c of cands) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(c.price - mean(last.map((x) => x.price))) <= tol) {
      last.push(c);
    } else {
      clusters.push([c]);
    }
  }

  const t0 = candles[0].time;
  const span = candles[candles.length - 1].time - t0 || 1;
  const w = CONFIG.weights;
  const zones: Zone[] = [];

  for (const cl of clusters) {
    const center = mean(cl.map((x) => x.price));
    const half = CONFIG.zoneWidthAtr * atr;
    const lo = center - half;
    const hi = center + half;
    const kind = center >= price ? "resistance" : "support";

    const tags = [...new Set(cl.filter((x) => x.source !== "pivot").map((x) => x.source))].sort();
    const touches = cl.filter((x) => x.source === "pivot").length;

    const volS = volumeAtPrice(profile, center);
    const touchS = Math.min(touches / 4, 1);
    const rejS = rejectionAt(candles, lo, hi, atr);
    const confS = Math.min(tags.length / 3, 1);
    const times = cl.filter((x) => x.time !== null).map((x) => x.time as number);
    const recencyS = times.length
      ? clamp01((Math.max(...times) - t0) / span)
      : 0.5;

    const strength =
      100 *
      (w.volume * volS +
        w.touches * touchS +
        w.rejection * rejS +
        w.confluence * confS +
        w.recency * recencyS);

    zones.push({
      price: center,
      lo,
      hi,
      kind,
      strength: Math.round(strength * 10) / 10,
      touches,
      tags,
      components: {
        volume: Math.round(volS * 100) / 100,
        touches: Math.round(touchS * 100) / 100,
        rejection: Math.round(rejS * 100) / 100,
        confluence: Math.round(confS * 100) / 100,
        recency: Math.round(recencyS * 100) / 100,
      },
    });
  }

  zones.sort((a, b) => b.strength - a.strength);
  return zones;
}
