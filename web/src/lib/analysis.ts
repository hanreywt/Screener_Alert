import { CONFIG } from "./config";
import { getKlines, getKlinesPaged, getPrice, atr as calcAtr } from "./binance";
import { buildProfile } from "./volumeProfile";
import { detectZones } from "./zones";
import { evaluate } from "./signals";
import { classifyRegime } from "./regime";
import { getRefLevels } from "./refLevels";
import { annotateContext } from "./flow";
import type { Analysis } from "./types";

export async function analyze(symbol: string): Promise<Analysis> {
  const [struct, trig, prof, price] = await Promise.all([
    getKlines(symbol, CONFIG.structTf, CONFIG.structLookback),
    getKlines(symbol, CONFIG.triggerTf, CONFIG.triggerLookback),
    // Same ~500h window as `struct`, just at finer resolution — profile only.
    getKlinesPaged(symbol, CONFIG.profileTf, CONFIG.profileLookback),
    getPrice(symbol),
  ]);

  const atr = calcAtr(struct); // ATR, pivots, rejection, regime: still structTf
  const profile = buildProfile(prof);
  const zones = detectZones(struct, profile, atr, price);
  const rinfo = classifyRegime(struct, CONFIG.regimeLookback, CONFIG.regimeMinEr);
  const signals = evaluate(symbol, price, zones, trig, atr, rinfo.regime);

  // Decorate each signal with DISPLAY-ONLY context (order-flow imbalance + POC
  // rotation). Attached after the signal path — never feeds scoring. See flow.ts.
  annotateContext(signals, price, profile, trig);

  // Reference levels are resolved AFTER the signal path, and are not passed into
  // it. They exist for the human reading the scan — see lib/refLevels.ts.
  const refLevels = await getRefLevels(symbol, price);

  return {
    symbol,
    price,
    atr,
    regime: rinfo.regime,
    regimeEr: rinfo.er,
    updatedAt: Date.now(),
    candles: struct,
    profile,
    zones,
    signals,
    refLevels,
  };
}
