import { getKlines, lastClosedIndex } from "./binance";

/**
 * Previous-period high/low — the classic liquidity reference levels.
 *
 * DISPLAY ONLY. These are deliberately NOT fed into detectZones() or evaluate():
 *
 *   - The strategy's entry has no measured predictive edge (docs/edge-criteria.md),
 *     so adding candidates to it would only add knobs — and every extra knob is
 *     another chance to fit noise. Keeping these out of the signal path means the
 *     existing backtest stays valid; nothing about the alerts changes.
 *   - Their value here is to the human doing discretionary trading: PDH/PDL and
 *     PWH/PWL are where resting stops and breakout orders cluster, so knowing
 *     which side of them price is sitting tells you what area you're in.
 *
 * If we ever want to TRADE them, that's a separate hypothesis (a sweep/reversal
 * signal), pre-registered and backtested on its own — not bolted onto this one.
 *
 * Periods are Binance's UTC day and Monday-anchored UTC week.
 */
export interface RefLevel {
  label: string; // "PDH" | "PDL" | "PWH" | "PWL"
  name: string; // human-readable
  price: number;
}

export interface RefLevels {
  levels: RefLevel[];
  /** Where price sits relative to the previous day's range. */
  dayRange: { high: number; low: number; insideRange: boolean } | null;
}

/**
 * The last CLOSED candle of `interval` — its high/low are final. Picked by close
 * time, not by position: see lastClosedIndex() for why `length - 2` is a trap.
 */
async function lastClosed(symbol: string, interval: "1d" | "1w") {
  const k = await getKlines(symbol, interval, 3);
  const i = lastClosedIndex(k, interval);
  return i >= 0 ? k[i] : null;
}

export async function getRefLevels(symbol: string, price: number): Promise<RefLevels> {
  const [day, week] = await Promise.all([
    lastClosed(symbol, "1d"),
    lastClosed(symbol, "1w"),
  ]);

  const levels: RefLevel[] = [];
  if (day) {
    levels.push({ label: "PDH", name: "Prev day high", price: day.high });
    levels.push({ label: "PDL", name: "Prev day low", price: day.low });
  }
  if (week) {
    levels.push({ label: "PWH", name: "Prev week high", price: week.high });
    levels.push({ label: "PWL", name: "Prev week low", price: week.low });
  }

  return {
    levels,
    dayRange: day
      ? {
          high: day.high,
          low: day.low,
          insideRange: price <= day.high && price >= day.low,
        }
      : null,
  };
}
