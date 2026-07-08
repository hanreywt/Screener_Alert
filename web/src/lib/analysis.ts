import { CONFIG } from "./config";
import { getKlines, getPrice, atr as calcAtr } from "./binance";
import { buildProfile } from "./volumeProfile";
import { detectZones } from "./zones";
import { evaluate } from "./signals";
import { classifyRegime } from "./regime";
import type { Analysis } from "./types";

export async function analyze(symbol: string): Promise<Analysis> {
  const [struct, trig, price] = await Promise.all([
    getKlines(symbol, CONFIG.structTf, CONFIG.structLookback),
    getKlines(symbol, CONFIG.triggerTf, CONFIG.triggerLookback),
    getPrice(symbol),
  ]);

  const atr = calcAtr(struct);
  const profile = buildProfile(struct);
  const zones = detectZones(struct, profile, atr, price);
  const rinfo = classifyRegime(struct, CONFIG.regimeLookback, CONFIG.regimeMinEr);
  const signals = evaluate(symbol, price, zones, trig, atr, rinfo.regime);

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
  };
}
