/**
 * Throwaway: what does switching the volume profile from 1h to 15m actually
 * change in the ALERT path, right now, on live data? Builds zones + signals
 * both ways for every symbol and diffs them.
 *
 *   npx tsx scripts/profile-diff.ts
 */
import { CONFIG, SYMBOLS, SYMBOL_TUNING } from "../src/lib/config";
import { getKlines, getKlinesPaged, getPrice, atr as calcAtr } from "../src/lib/binance";
import { buildProfile } from "../src/lib/volumeProfile";
import { detectZones } from "../src/lib/zones";
import { classifyRegime } from "../src/lib/regime";
import { evaluate } from "../src/lib/signals";
import type { Zone } from "../src/lib/types";

const pct = (a: number, b: number) => ((a - b) / b) * 100;

async function main() {
  console.log(`Profile A/B on live data — 1h (old) vs 15m (new)\n`);

  for (const sym of SYMBOLS) {
    const [struct, trig, prof, price] = await Promise.all([
      getKlines(sym, CONFIG.structTf, CONFIG.structLookback),
      getKlines(sym, CONFIG.triggerTf, CONFIG.triggerLookback),
      getKlinesPaged(sym, CONFIG.profileTf, CONFIG.profileLookback),
      getPrice(sym),
    ]);
    const atr = calcAtr(struct);
    const regime = classifyRegime(struct, CONFIG.regimeLookback, CONFIG.regimeMinEr).regime;

    const pOld = buildProfile(struct);
    const pNew = buildProfile(prof);
    const zOld = detectZones(struct, pOld, atr, price);
    const zNew = detectZones(struct, pNew, atr, price);
    const sOld = evaluate(sym, price, zOld, trig, atr, regime);
    const sNew = evaluate(sym, price, zNew, trig, atr, regime);

    const minStr = SYMBOL_TUNING[sym]?.minStrengthAlert ?? CONFIG.minStrengthAlert;
    const alertable = (z: Zone[]) => z.filter((x) => x.strength >= minStr).length;

    console.log(`━━ ${sym}  price ${price}  ATR ${atr.toFixed(4)}  (${regime})`);
    console.log(
      `   POC  ${pOld.poc.toFixed(4)} → ${pNew.poc.toFixed(4)}  (${pct(pNew.poc, pOld.poc).toFixed(2)}%)`,
    );
    console.log(
      `   VAH  ${pOld.vah.toFixed(4)} → ${pNew.vah.toFixed(4)}  (${pct(pNew.vah, pOld.vah).toFixed(2)}%)   ` +
        `VAL  ${pOld.val.toFixed(4)} → ${pNew.val.toFixed(4)}  (${pct(pNew.val, pOld.val).toFixed(2)}%)`,
    );
    console.log(`   HVNs ${pOld.hvns.length} → ${pNew.hvns.length}   zones ${zOld.length} → ${zNew.length}   alertable(≥${minStr}) ${alertable(zOld)} → ${alertable(zNew)}`);

    const fmt = (s: typeof sOld) =>
      s.length ? s.map((x) => `${x.kind}@${x.zonePrice}(${x.strength})`).join(", ") : "none";
    console.log(`   signals OLD: ${fmt(sOld)}`);
    console.log(`   signals NEW: ${fmt(sNew)}`);

    // Would the dedupe key survive the switch? Key = symbol:kind:zonePrice.
    const keyOld = new Set(sOld.map((x) => `${x.kind}:${x.zonePrice}`));
    const shared = sNew.filter((x) => keyOld.has(`${x.kind}:${x.zonePrice}`)).length;
    if (sNew.length) console.log(`   dedupe keys reused: ${shared}/${sNew.length} → ${sNew.length - shared} would RE-ALERT`);
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
