/**
 * DISPLAY-ONLY context for the alert: order-flow imbalance and value-area
 * rotation. Neither feeds zones, signals, or the journal — they are read-outs
 * for a human deciding whether to act, and they make NO edge or direction claim.
 *
 * Grounded in the 2026-07 research (docs/validation.md): on these levels order
 * flow marks EXHAUSTION, not continuation (aggressive flow INTO an edge tends to
 * fail there), and POC is a genuine rotation magnet. That research also showed
 * the effect is real but too small to trade mechanically — hence: context, not a
 * signal. Keep the wording descriptive; never phrase it as "buy" / "sell".
 */
import type { Candle, VolumeProfile } from "./types";

const FLOW_BARS = 12; // trigger candles of flow into the moment (~1h on 5m)
const EXH_THR = 0.1; // |imbalance| above this reads as one-sided pressure

/** Net taker imbalance over the last `n` candles, in [-1, 1]: +1 all taker buys,
 *  −1 all taker sells. Missing takerBuy → that bar counts as neutral. */
export function takerImbalance(candles: Candle[], n = FLOW_BARS): number {
  const s = candles.slice(-n);
  let buy = 0;
  let vol = 0;
  for (const c of s) {
    buy += c.takerBuy ?? c.volume / 2;
    vol += c.volume;
  }
  return vol > 0 ? (2 * buy - vol) / vol : 0;
}

const pctOf = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

/**
 * One-line order-flow read. Flags the exhaustion case — aggressive flow pushing
 * INTO the value edge it's testing (the move research found tends to fail there)
 * — otherwise just states the net pressure. Descriptive, no recommendation.
 */
export function flowNote(price: number, profile: VolumeProfile, imbalance: number): string | undefined {
  const buyDom = imbalance >= EXH_THR;
  const sellDom = imbalance <= -EXH_THR;
  const atUpper = price >= profile.vah;
  const atLower = price <= profile.val;

  if (atUpper && buyDom) return `🔺 ${pctOf(imbalance)} taker-buy pushing into the upper value edge — aggressive buyers testing resistance, watch for absorption`;
  if (atLower && sellDom) return `🔻 ${pctOf(imbalance)} taker-sell pushing into the lower value edge — aggressive sellers testing support, watch for absorption`;
  if (buyDom) return `net ${pctOf(imbalance)} taker-buy pressure`;
  if (sellDom) return `net ${pctOf(imbalance)} taker-sell pressure`;
  return `balanced taker flow`;
}

/**
 * Where price sits in the value area and where POC — the volume magnet — is
 * relative to it. Most useful at the edges, where the rotation-to-POC read is
 * live; still informative inside value.
 */
export function rotationNote(price: number, profile: VolumeProfile): string {
  const { poc, vah, val } = profile;
  const pct = ((poc - price) / price) * 100;
  const arrow = poc > price ? "↑" : "↓";
  const pos = price >= vah ? "above value area (upper edge)" : price <= val ? "below value area (lower edge)" : "inside value area";
  return `${pos} · POC ${fmt(poc)} rotation target (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% ${arrow}) · VA ${fmt(val)}–${fmt(vah)}`;
}

/** Attach both display notes to every signal for a symbol, computed once from
 *  the trigger series (flow) and the profile (rotation). */
export function annotateContext(
  signals: { flowNote?: string; rotationNote?: string }[],
  price: number,
  profile: VolumeProfile,
  trig: Candle[],
): void {
  if (!signals.length) return;
  const imbalance = takerImbalance(trig, FLOW_BARS);
  const flow = flowNote(price, profile, imbalance);
  const rotation = rotationNote(price, profile);
  for (const s of signals) {
    s.flowNote = flow;
    s.rotationNote = rotation;
  }
}
