/**
 * Backtest the S/R break-and-retest strategy over historical Binance data,
 * reusing the EXACT live logic in src/lib (zones, regime, signals) so there is
 * no logic drift. Look-ahead-safe: at each step the analysis only sees candles
 * that had closed by then.
 *
 *   MONTHS=3 node --import tsx scripts/backtest.ts
 *   MONTHS=6 SYMBOLS=BTCUSDT,ETHUSDT node --import tsx scripts/backtest.ts
 *
 * Costs: taker fee + slippage applied round-trip. Reports trades, win rate,
 * expectancy (R), profit factor, and max drawdown — with the regime filter ON
 * and OFF for comparison.
 */
import { CONFIG, SYMBOLS as ALL_SYMBOLS, BINANCE_HOSTS } from "../src/lib/config";
import { atr as calcAtr } from "../src/lib/binance";
import { buildProfile } from "../src/lib/volumeProfile";
import { detectZones } from "../src/lib/zones";
import { classifyRegime } from "../src/lib/regime";
import { evaluate } from "../src/lib/signals";
import type { Candle } from "../src/lib/types";

const MONTHS = Number(process.env.MONTHS ?? 3);
const SYMBOLS = (process.env.SYMBOLS?.split(",") ?? ALL_SYMBOLS) as string[];
const FEE_RT = 0.001; // 0.1% round-trip taker fee
const SLIP_RT = 0.0004; // 0.04% round-trip slippage
const TIMEOUT_BARS = 96; // exit a trade after this many trigger candles (~8h on 5m)

const TF_MS: Record<string, number> = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };

interface Raw { openMs: number; closeMs: number; open: number; high: number; low: number; close: number; volume: number; }

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Raw[]> {
  const host = BINANCE_HOSTS[2]; // data-api.binance.vision — reliable for history
  const out: Raw[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cur}&limit=1000`;
    const rows = (await fetch(url).then((r) => r.json())) as number[][];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const k of rows) {
      out.push({ openMs: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeMs: k[6] });
    }
    cur = rows[rows.length - 1][6] + 1;
    if (rows.length < 1000) break;
  }
  return out.filter((r) => r.closeMs <= endMs);
}

const toCandle = (r: Raw): Candle => ({ time: Math.floor(r.openMs / 1000), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });

interface Trade { entry: number; stop: number; target: number; dir: 1 | -1; risk: number; openIdx: number; }
interface Result { R: number; outcome: string; }

function runSymbol(struct: Raw[], trig: Raw[], enforceRegime: boolean): Result[] {
  const results: Result[] = [];
  const open = new Map<string, Trade>();
  let sIdx = 0;
  let zones: ReturnType<typeof detectZones> = [];
  let atrVal = 0;
  let regime: ReturnType<typeof classifyRegime>["regime"] = "range";

  for (let i = 0; i < trig.length; i++) {
    const tc = trig[i];

    let rebuilt = false;
    while (sIdx < struct.length && struct[sIdx].closeMs <= tc.openMs) { sIdx++; rebuilt = true; }
    if (sIdx < CONFIG.structLookback) continue; // warm-up: need full structural window
    if (rebuilt) {
      const sw = struct.slice(sIdx - CONFIG.structLookback, sIdx).map(toCandle);
      atrVal = calcAtr(sw);
      const profile = buildProfile(sw);
      zones = detectZones(sw, profile, atrVal, tc.open);
      regime = classifyRegime(sw, CONFIG.regimeLookback, CONFIG.regimeMinEr).regime;
    }

    // 1) Manage open trades against this candle's range.
    for (const [key, t] of open) {
      const hitStop = t.dir > 0 ? tc.low <= t.stop : tc.high >= t.stop;
      const hitTgt = t.dir > 0 ? tc.high >= t.target : tc.low <= t.target;
      let exit: number | null = null;
      let outcome = "";
      if (hitStop) { exit = t.stop; outcome = "loss"; } // conservative: stop before target
      else if (hitTgt) { exit = t.target; outcome = "win"; }
      else if (i - t.openIdx >= TIMEOUT_BARS) { exit = tc.close; outcome = "timeout"; }
      if (exit != null) {
        const gross = (exit - t.entry) * t.dir;
        const cost = t.entry * (FEE_RT + SLIP_RT);
        results.push({ R: (gross - cost) / t.risk, outcome });
        open.delete(key);
      }
    }

    // 2) Generate signals at this candle's close; open new retest trades.
    const trigWin = trig.slice(Math.max(0, i - CONFIG.triggerLookback + 1), i + 1).map(toCandle);
    const sigs = evaluate("BT", tc.close, zones, trigWin, atrVal, regime, enforceRegime);
    for (const s of sigs) {
      if (s.kind !== "retest" || s.entry == null || s.stop == null || s.target == null) continue;
      const key = `${s.zonePrice}`;
      if (open.has(key)) continue;
      const dir: 1 | -1 = s.target > s.entry ? 1 : -1;
      const risk = Math.abs(s.entry - s.stop);
      if (risk <= 0) continue;
      open.set(key, { entry: s.entry, stop: s.stop, target: s.target, dir, risk, openIdx: i });
    }
  }
  return results;
}

function report(label: string, all: Result[]) {
  const n = all.length;
  if (n === 0) { console.log(`\n${label}: no trades`); return; }
  const wins = all.filter((r) => r.outcome === "win").length;
  const losses = all.filter((r) => r.outcome === "loss").length;
  const timeouts = all.filter((r) => r.outcome === "timeout").length;
  const sumR = all.reduce((a, r) => a + r.R, 0);
  const grossWin = all.filter((r) => r.R > 0).reduce((a, r) => a + r.R, 0);
  const grossLoss = Math.abs(all.filter((r) => r.R < 0).reduce((a, r) => a + r.R, 0));
  // max drawdown on the R equity curve
  let peak = 0, eq = 0, maxDD = 0;
  for (const r of all) { eq += r.R; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }
  console.log(`\n${label}`);
  console.log(`  trades ${n}  |  win ${wins}  loss ${losses}  timeout ${timeouts}`);
  console.log(`  win rate      ${((wins / (wins + losses || 1)) * 100).toFixed(1)}%  (excl. timeouts)`);
  console.log(`  expectancy    ${(sumR / n).toFixed(3)} R / trade`);
  console.log(`  total         ${sumR.toFixed(1)} R`);
  console.log(`  profit factor ${grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "∞"}`);
  console.log(`  max drawdown  ${maxDD.toFixed(1)} R`);
}

async function main() {
  const end = Date.now();
  const start = end - MONTHS * 30 * 864e5;
  const structStart = start - CONFIG.structLookback * TF_MS[CONFIG.structTf];
  console.log(`Backtest: ${SYMBOLS.join(", ")} · ${MONTHS}mo · struct ${CONFIG.structTf} / trigger ${CONFIG.triggerTf} · fee+slip ${((FEE_RT + SLIP_RT) * 100).toFixed(2)}%`);

  const onAll: Result[] = [];
  const offAll: Result[] = [];
  for (const sym of SYMBOLS) {
    process.stdout.write(`  fetching ${sym}… `);
    const [struct, trig] = await Promise.all([
      fetchKlines(sym, CONFIG.structTf, structStart, end),
      fetchKlines(sym, CONFIG.triggerTf, start, end),
    ]);
    console.log(`struct ${struct.length}, trigger ${trig.length}`);
    onAll.push(...runSymbol(struct, trig, true));
    offAll.push(...runSymbol(struct, trig, false));
  }

  report("REGIME FILTER ON (live behavior)", onAll);
  report("REGIME FILTER OFF (baseline)", offAll);
  console.log("\nNote: net of fees+slippage. Stop-before-target on same-bar touches (conservative).");
}

main().catch((e) => { console.error(e); process.exit(1); });
