/**
 * Train/test (walk-forward) research harness with risk control.
 *
 *   MONTHS=12 TRAIN=0.67 npx tsx scripts/research.ts
 *
 * Process:
 *  1. Split history into IN-SAMPLE (train) and OUT-OF-SAMPLE (test) by time.
 *  2. Sweep a SMALL parameter grid; pick the best config by TRAIN expectancy
 *     (min trade count enforced). Grid is capped to limit multiple-testing.
 *  3. Report that config's OUT-OF-SAMPLE result — the only number that counts.
 *  4. Costs (fee+slippage) included. Risk control: fixed-fractional sizing,
 *     compounding equity curve, max drawdown %, and a drawdown circuit breaker.
 *
 * Reuses the exact live logic (zones/regime/signals); look-ahead-safe.
 */
import { CONFIG, SYMBOLS as ALL, BINANCE_HOSTS } from "../src/lib/config";
import { atr as calcAtr } from "../src/lib/binance";
import { buildProfile } from "../src/lib/volumeProfile";
import { detectZones } from "../src/lib/zones";
import { classifyRegime } from "../src/lib/regime";
import { evaluate } from "../src/lib/signals";
import type { Candle, Zone, Regime } from "../src/lib/types";

const MONTHS = Number(process.env.MONTHS ?? 12);
const TRAIN = Number(process.env.TRAIN ?? 0.67); // fraction of history for training
const SYMBOLS = (process.env.SYMBOLS?.split(",") ?? ALL) as string[];
const FEE_RT = 0.001, SLIP_RT = 0.0004, COST_RT = FEE_RT + SLIP_RT;
const TIMEOUT_BARS = 96;
const RISK_FRAC = 0.01; // risk 1% of equity per trade
const DD_BREAKER = 0.2; // stop trading if equity drawdown exceeds 20%
const MIN_TRADES = 30; // a train config needs at least this many to qualify
const TF_MS: Record<string, number> = { "5m": 3e5, "1h": 36e5 };

interface Raw { openMs: number; closeMs: number; open: number; high: number; low: number; close: number; volume: number; }
const toCandle = (r: Raw): Candle => ({ time: Math.floor(r.openMs / 1000), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Raw[]> {
  const host = BINANCE_HOSTS[2];
  const out: Raw[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const rows = (await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cur}&limit=1000`).then((r) => r.json())) as number[][];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const k of rows) out.push({ openMs: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeMs: k[6] });
    cur = rows[rows.length - 1][6] + 1;
    if (rows.length < 1000) break;
  }
  return out.filter((r) => r.closeMs <= endMs);
}

interface Snap { atr: number; zones: Zone[]; regime: Regime; }
interface Trade { openMs: number; entry: number; stop: number; target: number; dir: 1 | -1; risk: number; openIdx: number; }
interface Res { R: number; openMs: number; }

/** Precompute per-trigger-candle (atr, zones, regime) once per symbol. */
function precompute(struct: Raw[], trig: Raw[]): (Snap | null)[] {
  const snaps: (Snap | null)[] = new Array(trig.length).fill(null);
  let sIdx = 0, cur: Snap | null = null;
  for (let i = 0; i < trig.length; i++) {
    let rebuilt = false;
    while (sIdx < struct.length && struct[sIdx].closeMs <= trig[i].openMs) { sIdx++; rebuilt = true; }
    if (sIdx < CONFIG.structLookback) { snaps[i] = null; continue; }
    if (rebuilt || !cur) {
      const sw = struct.slice(sIdx - CONFIG.structLookback, sIdx).map(toCandle);
      const atr = calcAtr(sw);
      cur = { atr, zones: detectZones(sw, buildProfile(sw), atr, trig[i].open), regime: classifyRegime(sw, CONFIG.regimeLookback, CONFIG.regimeMinEr).regime };
    }
    snaps[i] = cur;
  }
  return snaps;
}

function collectEntries(trig: Raw[], snaps: (Snap | null)[], enforceRegime: boolean, minStrength: number): Trade[] {
  const saved = CONFIG.minStrengthAlert;
  CONFIG.minStrengthAlert = minStrength;
  const entries: Trade[] = [];
  const lastZone = new Map<string, number>();
  for (let i = 0; i < trig.length; i++) {
    const s = snaps[i];
    if (!s) continue;
    const trigWin = trig.slice(Math.max(0, i - CONFIG.triggerLookback + 1), i + 1).map(toCandle);
    for (const sig of evaluate("BT", trig[i].close, s.zones, trigWin, s.atr, s.regime, enforceRegime)) {
      if (sig.kind !== "retest" || sig.entry == null || sig.stop == null || sig.target == null) continue;
      const k = `${sig.zonePrice}`;
      if (i - (lastZone.get(k) ?? -1e9) < TIMEOUT_BARS) continue;
      const dir: 1 | -1 = sig.target > sig.entry ? 1 : -1;
      const risk = Math.abs(sig.entry - sig.stop);
      if (risk <= 0) continue;
      lastZone.set(k, i);
      entries.push({ openMs: trig[i].openMs, entry: sig.entry, stop: sig.stop, target: sig.target, dir, risk, openIdx: i });
    }
  }
  CONFIG.minStrengthAlert = saved;
  return entries;
}

function simulate(entries: Trade[], trig: Raw[], exitR: number | "zone"): Res[] {
  const out: Res[] = [];
  for (const e of entries) {
    const target = exitR === "zone" ? e.target : e.entry + e.dir * exitR * e.risk;
    let done = false;
    for (let j = e.openIdx + 1; j < trig.length && j <= e.openIdx + TIMEOUT_BARS; j++) {
      const c = trig[j];
      const hitStop = e.dir > 0 ? c.low <= e.stop : c.high >= e.stop;
      const hitTgt = e.dir > 0 ? c.high >= target : c.low <= target;
      let barrier: number | null = null, isWin = false;
      if (hitStop && hitTgt) barrier = Math.abs(c.open - e.stop) <= Math.abs(c.open - target) ? e.stop : ((isWin = true), target);
      else if (hitStop) barrier = e.stop;
      else if (hitTgt) { barrier = target; isWin = true; }
      if (barrier != null) { out.push({ R: ((barrier - e.entry) * e.dir - e.entry * COST_RT) / e.risk, openMs: e.openMs }); void isWin; done = true; break; }
    }
    if (!done) { const c = trig[Math.min(e.openIdx + TIMEOUT_BARS, trig.length - 1)]; out.push({ R: ((c.close - e.entry) * e.dir - e.entry * COST_RT) / e.risk, openMs: e.openMs }); }
  }
  return out;
}

const expectancy = (rs: Res[]) => (rs.length ? rs.reduce((a, r) => a + r.R, 0) / rs.length : 0);

/** Fixed-fractional equity sim with a drawdown circuit breaker. */
function equityCurve(rs: Res[]) {
  const sorted = [...rs].sort((a, b) => a.openMs - b.openMs);
  let eq = 1, peak = 1, maxDD = 0, broke = false, taken = 0;
  for (const r of sorted) {
    if ((peak - eq) / peak >= DD_BREAKER) { broke = true; break; } // circuit breaker
    eq *= 1 + RISK_FRAC * r.R;
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, (eq - peak) / peak);
    taken++;
  }
  return { ret: eq - 1, maxDD, broke, taken };
}

async function main() {
  const end = Date.now();
  const start = end - MONTHS * 30 * 864e5;
  const splitMs = start + TRAIN * (end - start);
  const structStart = start - CONFIG.structLookback * TF_MS[CONFIG.structTf];
  const inTrain = (ms: number) => ms < splitMs;

  console.log(`Walk-forward ${SYMBOLS.join(",")} · ${MONTHS}mo · train ${(TRAIN * 100).toFixed(0)}% / test ${((1 - TRAIN) * 100).toFixed(0)}% · cost ${(COST_RT * 100).toFixed(2)}%/rt\n`);

  const trigBySym: Record<string, Raw[]> = {};
  const snapBySym: Record<string, (Snap | null)[]> = {};
  for (const sym of SYMBOLS) {
    process.stdout.write(`fetching ${sym}… `);
    const [struct, trig] = await Promise.all([fetchKlines(sym, CONFIG.structTf, structStart, end), fetchKlines(sym, CONFIG.triggerTf, start, end)]);
    trigBySym[sym] = trig;
    snapBySym[sym] = precompute(struct, trig);
    console.log(`struct ${struct.length}, trigger ${trig.length}`);
  }

  // Small, capped parameter grid (limit multiple-testing).
  const grid: { minStrength: number; regime: boolean; exitR: number | "zone" }[] = [];
  for (const minStrength of [55, 70, 80])
    for (const regime of [true, false])
      for (const exitR of ["zone", 1, 2] as (number | "zone")[])
        grid.push({ minStrength, regime, exitR });

  console.log(`\nTrials: ${grid.length} configs (capped). Selecting best by TRAIN expectancy, min ${MIN_TRADES} trades.\n`);
  console.log("  cfg                         train           test");

  let best: { cfg: string; trainExp: number; test: Res[] } | null = null;
  for (const g of grid) {
    const all: Res[] = [];
    for (const sym of SYMBOLS) {
      const entries = collectEntries(trigBySym[sym], snapBySym[sym], g.regime, g.minStrength);
      all.push(...simulate(entries, trigBySym[sym], g.exitR));
    }
    const train = all.filter((r) => inTrain(r.openMs));
    const test = all.filter((r) => !inTrain(r.openMs));
    const cfg = `str≥${g.minStrength} rgm=${g.regime ? "on" : "off"} exit=${g.exitR}`;
    console.log(`  ${cfg.padEnd(26)} n${String(train.length).padStart(4)} ${(expectancy(train) >= 0 ? "+" : "") + expectancy(train).toFixed(3)}R   n${String(test.length).padStart(4)} ${(expectancy(test) >= 0 ? "+" : "") + expectancy(test).toFixed(3)}R`);
    if (train.length >= MIN_TRADES && (!best || expectancy(train) > best.trainExp)) best = { cfg, trainExp: expectancy(train), test };
  }

  console.log(`\n── VERDICT ──`);
  if (!best) { console.log("No config had enough training trades."); return; }
  console.log(`Best-on-train config: ${best.cfg}  (train exp +${best.trainExp.toFixed(3)}R)`);
  const oosExp = expectancy(best.test);
  console.log(`OUT-OF-SAMPLE expectancy: ${oosExp >= 0 ? "+" : ""}${oosExp.toFixed(3)}R over ${best.test.length} unseen trades`);
  const eq = equityCurve(best.test);
  console.log(`\nRisk-controlled OOS equity (risk ${(RISK_FRAC * 100).toFixed(0)}%/trade, ${(DD_BREAKER * 100).toFixed(0)}% DD breaker):`);
  console.log(`  return ${(eq.ret * 100).toFixed(1)}%   maxDD ${(eq.maxDD * 100).toFixed(1)}%   trades taken ${eq.taken}${eq.broke ? "  ⛔ circuit breaker tripped" : ""}`);
  console.log(`\n${oosExp > 0 ? "Positive OOS — worth deeper walk-forward before trusting." : "Negative OOS — the train edge did NOT generalize. No tradable edge found."}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
