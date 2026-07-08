import { CONFIG } from "./config";
import { getKlines, getPrice, atr as calcAtr } from "./binance";
import { buildProfile } from "./volumeProfile";
import { detectZones } from "./zones";
import { evaluate } from "./signals";
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
  const signals = evaluate(symbol, price, zones, trig, atr);

  return {
    symbol,
    price,
    atr,
    updatedAt: Date.now(),
    candles: struct,
    profile,
    zones,
    signals,
  };
}
