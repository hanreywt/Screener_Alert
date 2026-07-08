import type { Candle, Regime } from "./types";

export interface RegimeInfo {
  regime: Regime;
  er: number; // Kaufman efficiency ratio 0..1
  direction: 1 | -1; // net direction over the window
}

/**
 * Classify the market regime with Kaufman's Efficiency Ratio:
 *
 *   ER = |net change over N| / sum(|bar-to-bar change|)
 *
 * ER→1 means price moved in a straight line (clean trend); ER→0 means lots of
 * back-and-forth for little net progress (chop/range). Above `minEr` we call it
 * a trend (up/down by net direction); below, a range. Computed on the
 * structural timeframe, so it reflects the higher-timeframe context.
 *
 * Pure and unit-testable. Rationale: break-and-retest is trend-following, so we
 * only want to fire it when a real trend exists — not when price is ranging.
 */
export function classifyRegime(
  candles: Candle[],
  lookback: number,
  minEr: number,
): RegimeInfo {
  const n = Math.min(lookback, candles.length - 1);
  if (n < 2) return { regime: "range", er: 0, direction: 1 };

  const closes = candles.map((c) => c.close);
  const t = closes.length - 1;
  const start = t - n;

  const net = Math.abs(closes[t] - closes[start]);
  let path = 0;
  for (let i = start + 1; i <= t; i++) {
    path += Math.abs(closes[i] - closes[i - 1]);
  }
  const er = path > 0 ? net / path : 0;
  const direction: 1 | -1 = closes[t] >= closes[start] ? 1 : -1;
  const regime: Regime =
    er < minEr ? "range" : direction > 0 ? "trend_up" : "trend_down";

  return { regime, er: Math.round(er * 1000) / 1000, direction };
}
