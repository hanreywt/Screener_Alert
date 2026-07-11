/**
 * Research backtest for the S/R break-and-retest strategy. Reuses the EXACT
 * live logic in src/lib (zones, regime, signals) — no drift — and is
 * look-ahead-safe (each step only sees closed candles).
 *
 *   MONTHS=3 npx tsx scripts/backtest.ts
 *   MONTHS=6 SYMBOLS=BTCUSDT,ETHUSDT npx tsx scripts/backtest.ts
 *
 * Separates ENTRY generation (regime-gated retest signals) from EXIT simulation
 * so we can sweep exit rules against the same entries. Reports, net of
 * fees+slippage: trades, win rate, expectancy (R), profit factor, max drawdown,
 * and MFE/MAE to diagnose where the edge leaks.
 */
import { CONFIG, SYMBOLS as ALL_SYMBOLS, BINANCE_HOSTS } from "../src/lib/config";
import { atr as calcAtr } from "../src/lib/binance";
import { buildProfile } from "../src/lib/volumeProfile";
import { detectZones } from "../src/lib/zones";
import { classifyRegime } from "../src/lib/regime";
import { evaluate } from "../src/lib/signals";
import { review, formatReview, tBarFor } from "../src/lib/metrics";
import type { Candle } from "../src/lib/types";

const MONTHS = Number(process.env.MONTHS ?? 3);
const SYMBOLS = (process.env.SYMBOLS?.split(",") ?? ALL_SYMBOLS) as string[];
const FEE_RT = 0.001;
const SLIP_RT = 0.0004;
const COST_RT = FEE_RT + SLIP_RT;
const TIMEOUT_BARS = 96; // ~8h on 5m
const TF_MS: Record<string, number> = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };

interface Raw { openMs: number; closeMs: number; open: number; high: number; low: number; close: number; volume: number; }

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Raw[]> {
  const host = BINANCE_HOSTS[2];
  const out: Raw[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cur}&limit=1000`;
    const rows = (await fetch(url).then((r) => r.json())) as number[][];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const k of rows) out.push({ openMs: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeMs: k[6] });
    cur = rows[rows.length - 1][6] + 1;
    if (rows.length < 1000) break;
  }
  return out.filter((r) => r.closeMs <= endMs);
}

const toCandle = (r: Raw): Candle => ({ time: Math.floor(r.openMs / 1000), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });

interface Entry { entry: number; stop: number; target: number; dir: 1 | -1; risk: number; openIdx: number; }

/** Generate retest entries (independent of exit rule). Cooldown de-dupes the
 *  same zone re-firing on consecutive candles.
 *
 *  `prof` is the finer series the volume profile is built from. Pass the struct
 *  series itself to reproduce the old 1h-profile behaviour (the A/B baseline). */
function collectEntries(struct: Raw[], trig: Raw[], prof: Raw[], enforceRegime: boolean): Entry[] {
  const entries: Entry[] = [];
  const lastOpenOnZone = new Map<string, number>();
  let sIdx = 0;
  let zones: ReturnType<typeof detectZones> = [];
  let atrVal = 0;
  let regime: ReturnType<typeof classifyRegime>["regime"] = "range";
  // Moving bounds into `prof` — both window edges advance monotonically with
  // sIdx, so the profile slice costs O(n) overall rather than O(n) per rebuild.
  let pLo = 0;
  let pHi = 0;

  for (let i = 0; i < trig.length; i++) {
    const tc = trig[i];
    let rebuilt = false;
    while (sIdx < struct.length && struct[sIdx].closeMs <= tc.openMs) { sIdx++; rebuilt = true; }
    if (sIdx < CONFIG.structLookback) continue;
    if (rebuilt) {
      const sw = struct.slice(sIdx - CONFIG.structLookback, sIdx).map(toCandle);
      atrVal = calcAtr(sw);
      // Profile window = the SAME time span as the structural window, at finer
      // resolution. Only bars fully closed by now — no lookahead.
      const winStart = struct[sIdx - CONFIG.structLookback].openMs;
      const winEnd = struct[sIdx - 1].closeMs;
      while (pLo < prof.length && prof[pLo].openMs < winStart) pLo++;
      while (pHi < prof.length && prof[pHi].closeMs <= winEnd) pHi++;
      const pw = prof.slice(pLo, pHi).map(toCandle);
      zones = detectZones(sw, buildProfile(pw.length ? pw : sw), atrVal, tc.open);
      regime = classifyRegime(sw, CONFIG.regimeLookback, CONFIG.regimeMinEr).regime;
    }
    const trigWin = trig.slice(Math.max(0, i - CONFIG.triggerLookback + 1), i + 1).map(toCandle);
    for (const s of evaluate("BT", tc.close, zones, trigWin, atrVal, regime, enforceRegime)) {
      if (s.kind !== "retest" || s.entry == null || s.stop == null || s.target == null) continue;
      const zoneKey = `${s.zonePrice}`;
      if (i - (lastOpenOnZone.get(zoneKey) ?? -1e9) < TIMEOUT_BARS) continue; // cooldown
      const dir: 1 | -1 = s.target > s.entry ? 1 : -1;
      const risk = Math.abs(s.entry - s.stop);
      if (risk <= 0) continue;
      lastOpenOnZone.set(zoneKey, i);
      entries.push({ entry: s.entry, stop: s.stop, target: s.target, dir, risk, openIdx: i });
    }
  }
  return entries;
}

type Fill = "pessimistic" | "realistic";
interface ExitRule { name: string; targetR?: number; breakevenAt?: number; } // targetR undefined = use zone target

interface Res { R: number; outcome: string; mfe: number; mae: number; openedAt: number; resolvedAt: number; sym: string; }

function simulate(entries: Entry[], trig: Raw[], rule: ExitRule, fill: Fill, sym: string): Res[] {
  const out: Res[] = [];
  for (const e of entries) {
    const target = rule.targetR != null ? e.entry + e.dir * rule.targetR * e.risk : e.target;
    let stop = e.stop;
    let mfe = 0, mae = 0;
    let done = false;
    const openedAt = trig[e.openIdx].closeMs; // entry fills at the signal bar's close
    for (let j = e.openIdx + 1; j < trig.length && j <= e.openIdx + TIMEOUT_BARS; j++) {
      const c = trig[j];
      const favExtreme = ((e.dir > 0 ? c.high : c.low) - e.entry) * e.dir / e.risk;
      const advExtreme = ((e.dir > 0 ? c.low : c.high) - e.entry) * e.dir / e.risk;
      mfe = Math.max(mfe, favExtreme);
      mae = Math.min(mae, advExtreme);
      if (rule.breakevenAt != null && mfe >= rule.breakevenAt) stop = e.entry;

      const hitStop = e.dir > 0 ? c.low <= stop : c.high >= stop;
      const hitTgt = e.dir > 0 ? c.high >= target : c.low <= target;
      let barrier: "stop" | "target" | null = null;
      if (hitStop && hitTgt) {
        if (fill === "pessimistic") barrier = "stop";
        else barrier = Math.abs(c.open - stop) <= Math.abs(c.open - target) ? "stop" : "target"; // nearer open first
      } else if (hitStop) barrier = "stop";
      else if (hitTgt) barrier = "target";

      if (barrier) {
        const exit = barrier === "stop" ? stop : target;
        out.push({ R: ((exit - e.entry) * e.dir - e.entry * COST_RT) / e.risk, outcome: barrier === "target" ? "win" : "loss", mfe, mae, openedAt, resolvedAt: c.closeMs, sym });
        done = true;
        break;
      }
    }
    if (!done) {
      const last = trig[Math.min(e.openIdx + TIMEOUT_BARS, trig.length - 1)];
      out.push({ R: ((last.close - e.entry) * e.dir - e.entry * COST_RT) / e.risk, outcome: "timeout", mfe, mae, openedAt, resolvedAt: last.closeMs, sym });
    }
  }
  return out;
}

function stats(all: Res[]) {
  const n = all.length;
  if (n === 0) return null;
  // "Win" = a profitable trade, matching metrics.ts. Counting only outcome==="win"
  // would drop timeouts entirely and report a different win rate than the review.
  const wins = all.filter((r) => r.R > 0).length;
  const losses = all.filter((r) => r.R < 0).length;
  const sumR = all.reduce((a, r) => a + r.R, 0);
  const gW = all.filter((r) => r.R > 0).reduce((a, r) => a + r.R, 0);
  const gL = Math.abs(all.filter((r) => r.R < 0).reduce((a, r) => a + r.R, 0));
  let peak = 0, eq = 0, dd = 0;
  for (const r of all) { eq += r.R; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const avgMfe = all.reduce((a, r) => a + r.mfe, 0) / n;
  const reached1R = all.filter((r) => r.mfe >= 1).length / n;
  // t-stat of per-trade R vs zero: is the expectancy distinguishable from luck?
  const exp = sumR / n;
  const variance = n > 1 ? all.reduce((a, r) => a + (r.R - exp) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const t = sd > 0 ? exp / (sd / Math.sqrt(n)) : 0;
  return { n, wins, losses, winRate: (wins / (wins + losses || 1)) * 100, exp, pf: gL > 0 ? gW / gL : Infinity, dd, avgMfe, reached1R, sd, t };
}

function line(label: string, s: ReturnType<typeof stats>) {
  if (!s) { console.log(`  ${label.padEnd(22)} no trades`); return; }
  console.log(`  ${label.padEnd(22)} n=${String(s.n).padStart(4)}  win ${s.winRate.toFixed(0).padStart(3)}%  exp ${s.exp >= 0 ? "+" : ""}${s.exp.toFixed(3)}R  PF ${s.pf.toFixed(2)}  DD ${s.dd.toFixed(0)}R  t=${s.t >= 0 ? "+" : ""}${s.t.toFixed(2)}`);
}

async function main() {
  const end = Date.now();
  const start = end - MONTHS * 30 * 864e5;
  const structStart = start - CONFIG.structLookback * TF_MS[CONFIG.structTf];
  // A/B: build the volume profile from each of these, everything else identical.
  // "struct" = the old behaviour (profile off the 1h structural candles).
  const profileTfs = (process.env.PROFILE_TF ?? `struct,${CONFIG.profileTf}`).split(",");
  console.log(`Backtest ${SYMBOLS.join(",")} · ${MONTHS}mo · ${CONFIG.structTf}/${CONFIG.triggerTf} · cost ${(COST_RT * 100).toFixed(2)}%/rt`);
  console.log(`Profile A/B: ${profileTfs.join(" vs ")} (same ${CONFIG.structLookback}×${CONFIG.structTf} window)\n`);

  // Fetch once per symbol; collect regime ON/OFF entries; keep trig for exits.
  const trigBySym: Record<string, Raw[]> = {};
  const cache: Record<string, Entry[]> = {};
  for (const sym of SYMBOLS) {
    process.stdout.write(`fetching ${sym}… `);
    const [struct, trig] = await Promise.all([
      fetchKlines(sym, CONFIG.structTf, structStart, end),
      fetchKlines(sym, CONFIG.triggerTf, start, end),
    ]);
    // One finer series per profile TF under test, over the same span as struct.
    const profBySym: Record<string, Raw[]> = { struct };
    for (const tf of profileTfs) {
      if (tf === "struct" || profBySym[tf]) continue;
      profBySym[tf] = await fetchKlines(sym, tf, structStart, end);
    }
    console.log(
      `struct ${struct.length}, trigger ${trig.length}` +
        profileTfs.filter((t) => t !== "struct").map((t) => `, ${t} ${profBySym[t].length}`).join(""),
    );
    trigBySym[sym] = trig;
    for (const tf of profileTfs) {
      cache[`${sym}:${tf}:true`] = collectEntries(struct, trig, profBySym[tf], true);
      cache[`${sym}:${tf}:false`] = collectEntries(struct, trig, profBySym[tf], false);
    }
  }

  const gather = (ptf: string, enforceRegime: boolean, rule: ExitRule, fill: Fill): Res[] => {
    const res: Res[] = [];
    for (const sym of SYMBOLS) res.push(...simulate(cache[`${sym}:${ptf}:${enforceRegime}`], trigBySym[sym], rule, fill, sym));
    return res;
  };
  // Default profile TF for the non-A/B sections below: the last one under test.
  const base = profileTfs[profileTfs.length - 1];

  console.log(`\nPROFILE TIMEFRAME (regime ON, zone target, realistic)`);
  for (const tf of profileTfs) {
    line(tf === "struct" ? `${CONFIG.structTf} (baseline)` : tf, stats(gather(tf, true, { name: "zone" }, "realistic")));
  }
  // Is any improvement over the baseline real, or is it inside the noise?
  const bs = stats(gather("struct", true, { name: "zone" }, "realistic"));
  if (bs) {
    for (const tf of profileTfs.filter((t) => t !== "struct")) {
      const cs = stats(gather(tf, true, { name: "zone" }, "realistic"));
      if (!cs) continue;
      const se = Math.sqrt(bs.sd ** 2 / bs.n + cs.sd ** 2 / cs.n); // Welch
      const d = cs.exp - bs.exp;
      const tDiff = se > 0 ? d / se : 0;
      console.log(
        `  → ${tf} vs baseline: Δexp ${d >= 0 ? "+" : ""}${d.toFixed(3)}R  ` +
          `t=${tDiff.toFixed(2)}  ${Math.abs(tDiff) >= 2 ? "SIGNIFICANT" : "NOT significant (inside noise)"}`,
      );
    }
  }

  console.log(`\nFILL MODEL (profile ${base}, regime ON, zone target)`);
  line("pessimistic (stop 1st)", stats(gather(base, true, { name: "zone" }, "pessimistic")));
  line("realistic (open-dist)", stats(gather(base, true, { name: "zone" }, "realistic")));

  console.log(`\nREGIME FILTER (profile ${base}, zone target, realistic)`);
  line("ON", stats(gather(base, true, { name: "zone" }, "realistic")));
  line("OFF", stats(gather(base, false, { name: "zone" }, "realistic")));

  console.log(`\nEXIT SWEEP (profile ${base}, regime ON, realistic)`);
  line("zone target", stats(gather(base, true, { name: "zone" }, "realistic")));
  for (const k of [1, 1.5, 2, 3]) line(`fixed ${k}R`, stats(gather(base, true, { name: "fx", targetR: k }, "realistic")));
  line("2R + BE@1R", stats(gather(base, true, { name: "be", targetR: 2, breakevenAt: 1 }, "realistic")));

  const diag = stats(gather(base, true, { name: "zone" }, "realistic"));
  if (diag) console.log(`\nDIAGNOSIS  avg MFE ${diag.avgMfe.toFixed(2)}R · ${(diag.reached1R * 100).toFixed(0)}% of trades reached +1R before exit`);

  // Standardised performance review — same module the live journal uses, so
  // backtest and forward numbers are directly comparable.
  const all = gather(base, true, { name: "zone" }, "realistic");
  console.log(`\nPERFORMANCE REVIEW (profile ${base}, regime ON, zone target, realistic)`);
  console.log(`  risk/trade ${(CONFIG.riskPerTrade * 100).toFixed(1)}% of balance · rf = 0`);
  console.log(formatReview("ALL SYMBOLS POOLED", review(all, CONFIG.riskPerTrade)));

  // --- Per-symbol edge attribution -------------------------------------
  // Which token, if any, carries the edge? Read this section with suspicion:
  // slicing one strategy 5 ways is 5 shots at significance, so the best slice
  // looks good by luck far more often than a naive t=2 suggests. The bar below
  // is Bonferroni-adjusted for exactly that.
  const tBar = tBarFor(SYMBOLS.length);
  console.log(`\nPER-SYMBOL EDGE (profile ${base}, regime ON, zone target, realistic)`);
  console.log(`  ${SYMBOLS.length} slices → significance bar raised t=1.96 → t=${tBar} (Bonferroni), min 100 trades/symbol\n`);
  console.log(`  ${"symbol".padEnd(9)} ${"n".padStart(5)} ${"win".padStart(6)} ${"exp".padStart(8)} ${"PF".padStart(5)} ${"Sharpe".padStart(7)} ${"maxDD".padStart(8)} ${"t".padStart(6)}   verdict`);
  for (const sym of SYMBOLS) {
    const m = review(all.filter((r) => r.sym === sym), CONFIG.riskPerTrade);
    if (!m.totalTrades) { console.log(`  ${sym.padEnd(9)} no trades`); continue; }
    const t = m.tStat ?? 0;
    const enough = m.totalTrades >= 100;
    const verdict = !enough
      ? `UNDERPOWERED (n<100)`
      : t >= tBar
        ? `✅ EDGE (t≥${tBar})`
        : t <= -tBar
          ? `❌ RELIABLY NEGATIVE`
          : `— indistinguishable from luck`;
    console.log(
      `  ${sym.padEnd(9)} ${String(m.totalTrades).padStart(5)} ${`${m.winRate}%`.padStart(6)} ` +
        `${`${(m.expectancyR ?? 0) >= 0 ? "+" : ""}${m.expectancyR}R`.padStart(8)} ${String(m.profitFactor ?? "—").padStart(5)} ` +
        `${String(m.sharpe ?? "—").padStart(7)} ${`${m.maxDrawdownPct}%`.padStart(8)} ${`${t >= 0 ? "+" : ""}${t}`.padStart(6)}   ${verdict}`,
    );
  }
  console.log(`\n  A positive slice here is a HYPOTHESIS, not an edge. To promote it: re-run`);
  console.log(`  out-of-sample on that symbol alone, and confirm it forward in the journal.`);

  console.log(`\nNet of fees+slippage. Realistic fill: same-bar touch resolved by nearer-to-open barrier.`);
  console.log(`Money-space metrics (return/Sharpe/Sortino/Calmar/DD%) assume the sizing above — not edge itself.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
