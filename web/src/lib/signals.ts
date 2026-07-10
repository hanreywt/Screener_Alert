import { CONFIG, SYMBOL_TUNING } from "./config";
import type { Symbol } from "./config";
import type { Candle, Regime, Signal, Zone } from "./types";

function avgVol(candles: Candle[], n = 20): number {
  const s = candles.slice(-n);
  return s.reduce((a, c) => a + c.volume, 0) / (s.length || 1);
}

/** Rate how decisively `candle` broke `zone`. */
function rateBreak(candle: Candle, avg: number, zone: Zone, atr: number) {
  if (avg <= 0 || atr <= 0) return { broke: false, rating: 0, dir: 0 };
  const volExp = candle.volume / avg;
  const up = candle.close - zone.hi;
  const down = zone.lo - candle.close;
  const clear = Math.max(up, down);
  const dir = up > down ? 1 : -1;
  const broke = clear >= CONFIG.breakAtrMult * atr && volExp >= CONFIG.breakVolMult;
  const volScore = Math.min(volExp / (CONFIG.breakVolMult * 2), 1);
  const clearScore = Math.min(clear / atr, 1);
  const rating = Math.round((100 * (0.55 * volScore + 0.45 * clearScore)) * 10) / 10;
  return { broke, rating, dir };
}

/** Find the most recent decisive break of `zone` within the trigger window. */
function recentBreak(trig: Candle[], zone: Zone, atr: number) {
  const avg = avgVol(trig);
  for (let i = trig.length - 1; i >= Math.max(0, trig.length - 30); i--) {
    const r = rateBreak(trig[i], avg, zone, atr);
    if (r.broke) return { idx: i, dir: r.dir, rating: r.rating };
  }
  return null;
}

function buildRetest(
  symbol: string,
  price: number,
  zone: Zone,
  zones: Zone[],
  atr: number,
  dir: number,
): Signal | null {
  let entry = price;
  let stop: number;
  let target: number;
  let side: string;

  if (dir > 0) {
    stop = zone.lo - 0.5 * atr;
    const ups = zones.filter((z) => z.price > price + 0.5 * atr && z.strength >= 50);
    target = ups.length ? Math.min(...ups.map((z) => z.price)) : price + 2 * (entry - stop);
    side = "LONG";
  } else {
    stop = zone.hi + 0.5 * atr;
    const downs = zones.filter((z) => z.price < price - 0.5 * atr && z.strength >= 50);
    target = downs.length ? Math.max(...downs.map((z) => z.price)) : price - 2 * (stop - entry);
    side = "SHORT";
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return null;
  const rr = Math.round((reward / risk) * 100) / 100;
  if (rr < CONFIG.minRetestRr) return null; // enforce the R:R floor

  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    symbol,
    kind: "retest",
    zonePrice: r(zone.price),
    zoneKind: zone.kind,
    strength: zone.strength,
    price: r(price),
    detail: `Break-and-retest ${side}: price retesting flipped zone @ ${r(zone.price)} (strength ${zone.strength})`,
    entry: r(entry),
    stop: r(stop),
    target: r(target),
    rr,
    winrateNote:
      "Break-&-retest of HVN/strong zone: ~60-70% historical winrate in trend; only take if R:R >= 1.5.",
  };
}

export function evaluate(
  symbol: string,
  price: number,
  zones: Zone[],
  trig: Candle[],
  atr: number,
  regime: Regime,
  enforceRegime = true,
): Signal[] {
  const out: Signal[] = [];
  const tuning = SYMBOL_TUNING[symbol as Symbol] ?? {};
  const minStrength = tuning.minStrengthAlert ?? CONFIG.minStrengthAlert;
  const watchMin = tuning.watchMinStrength ?? CONFIG.watchMinStrength;
  const strong = zones.filter((z) => z.strength >= minStrength);
  const avg = avgVol(trig);
  const last = trig[trig.length - 1];
  const r = (n: number) => Math.round(n * 1e6) / 1e6;

  // A directional signal is "with trend" if it agrees with the regime.
  // In a range, breakouts are allowed (range breakout is a valid start of a
  // trend) but retests are not (they get chopped up). enforceRegime=false
  // disables the gate entirely (used by the backtest to compare on vs off).
  const breakAligned = (dir: number) =>
    !enforceRegime || (dir > 0 ? regime !== "trend_down" : regime !== "trend_up");
  const retestAligned = (dir: number) =>
    !enforceRegime || (dir > 0 ? regime === "trend_up" : regime === "trend_down");

  for (const z of strong) {
    const dist = Math.abs(price - z.price);
    const near = (price >= z.lo && price <= z.hi) || dist <= CONFIG.proximityAtr * atr;

    if (near) {
      const rb = rateBreak(last, avg, z, atr);
      if (rb.broke && breakAligned(rb.dir)) {
        const flip = rb.dir > 0 ? "support" : "resistance";
        out.push({
          symbol,
          kind: "break",
          zonePrice: r(z.price),
          zoneKind: z.kind,
          strength: z.strength,
          price: r(price),
          detail: `${z.kind.toUpperCase()} broken ${rb.dir > 0 ? "UP" : "DOWN"} on ${(last.volume / avg).toFixed(1)}x vol → flips to ${flip} [${regime}]`,
          breakRating: rb.rating,
          regime,
        });
      } else if (!rb.broke && z.strength >= watchMin) {
        // Watch is a heads-up, not a trade — only surface it for the
        // strongest zones to keep the channel quiet. Break/retest below still
        // fire for any zone >= minStrengthAlert.
        out.push({
          symbol,
          kind: "watch",
          zonePrice: r(z.price),
          zoneKind: z.kind,
          strength: z.strength,
          price: r(price),
          detail: `Price ${(dist / atr).toFixed(2)} ATR from ${z.kind} (strength ${z.strength}) — watch for reaction [${regime}]`,
          regime,
        });
      }
    }

    // Break-and-retest: a recent decisive break, price back at the zone, AND
    // the trade agrees with the regime (trend-following only, no chop).
    if (dist <= CONFIG.retestTolAtr * atr) {
      const rbk = recentBreak(trig, z, atr);
      if (rbk && rbk.idx < trig.length - 1 && retestAligned(rbk.dir)) {
        const sig = buildRetest(symbol, price, z, zones, atr, rbk.dir);
        if (sig) {
          sig.breakRating = rbk.rating;
          sig.regime = regime;
          out.push(sig);
        }
      }
    }
  }

  // De-dupe by kind+zone, keep strongest-first ordering.
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.kind}:${s.zonePrice}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
