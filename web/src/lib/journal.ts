import { getRedis } from "./redisClient";
import { CONFIG, SYMBOLS, EDGE_STATUS } from "./config";
import { sendTradeEntry, sendTradeExit } from "./discord/alerts";
import { review, tBarFor, type PerfReview, type ClosedTrade } from "./metrics";
import type { Signal } from "./types";

/**
 * Forward track record for retest trade signals. When a retest fires we open a
 * "paper trade" (entry/stop/target) in Redis; on later runs we mark-to-market
 * against the current price and resolve it as win / loss / expired, keeping
 * running aggregates. This builds an honest, un-overfittable record of how the
 * flagship signal actually performs live — complements the historical backtest.
 *
 * Prices are sampled once per cron run, so exact intrabar fills aren't captured
 * (the backtest is candle-accurate); this is a directional live validator.
 */
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // resolve/expire a trade after 48h
const HISTORY_LIMIT = 1000; // closed trades retained for the performance review
const RECENT_SHOWN = 50; // how many the dashboard table renders
const MIN_FWD_TRADES = 30; // Gate B: below this, a symbol's record means nothing

interface OpenTrade {
  symbol: string;
  dir: 1 | -1;
  entry: number;
  stop: number;
  target: number;
  risk: number;
  ts: number;
  mfe: number; // max favorable excursion (R)
  mae: number; // max adverse excursion (R)
  regime?: string;
  rr: number; // reward:risk at entry
  riskPct: number; // stop distance as % of entry
  sizeNotional: number; // suggested position notional (journal only)
  lastR?: number; // latest unrealized R (mark-to-market)
  lastPrice?: number; // latest sampled price
}

export interface JournalStats {
  fired: Record<string, number>;
  trades: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number | null;
  expectancyR: number | null;
  totalR: number; // all-time cumulative R
  startEquity: number; // reference account ($)
  riskPerTrade: number; // fraction of balance risked per trade
  riskUsd: number; // $ risked on the NEXT trade (current balance × riskPerTrade)
  pnlUsd: number; // PnL in $ over the tracked window
  balanceUsd: number; // compounded balance
  perf: PerfReview; // standardised performance review (same module as backtest)
  perfBySymbol: Record<string, PerfReview>; // per-token edge attribution
  tBar: number; // Bonferroni-adjusted significance bar for the per-symbol slices
  recent: unknown[];
  open: unknown[]; // currently-running paper trades
}

/** Record fired signals: frequency counts + open a paper trade per retest. */
export async function logSignals(signals: Signal[]): Promise<void> {
  const r = getRedis();
  if (!r) return;
  // Snapshot the record BEFORE this batch opens anything, so the entry alert
  // reports the track record as it stood when the decision was made.
  const notes = signals.some((s) => s.kind === "retest") ? await forwardNotes() : {};
  for (const s of signals) {
    await r.incr(`sig:fired:${s.kind}`);
    if (s.kind !== "retest") continue;
    if (s.entry == null || s.stop == null || s.target == null) continue;

    const key = `sig:o:${s.symbol}:${s.zonePrice}`;
    if (await r.exists(key)) continue; // trade already open on this zone

    const dir: 1 | -1 = s.target > s.entry ? 1 : -1;
    const risk = Math.abs(s.entry - s.stop);
    if (risk <= 0) continue;

    // Position-size suggestion (journal only): risk a fixed fraction of a
    // reference account per trade → notional = equity·riskFrac·entry / risk.
    const trade: OpenTrade = {
      symbol: s.symbol,
      dir,
      entry: s.entry,
      stop: s.stop,
      target: s.target,
      risk,
      ts: Date.now(),
      mfe: 0,
      mae: 0,
      regime: s.regime,
      rr: Math.round((Math.abs(s.target - s.entry) / risk) * 100) / 100,
      riskPct: Math.round((risk / s.entry) * 10000) / 100,
      sizeNotional: Math.round((CONFIG.accountEquity * CONFIG.riskPerTrade * s.entry) / risk),
    };
    await r.set(key, JSON.stringify(trade));
    await r.sadd("sig:open", key);

    // Entry alert fires only here — when a NEW trade actually opens (the
    // `exists` guard above prevents doubling on a re-fired retest).
    await sendTradeEntry({
      symbol: s.symbol,
      dir,
      entry: s.entry,
      stop: s.stop,
      target: s.target,
      rr: trade.rr,
      riskUsd: Math.round(CONFIG.accountEquity * CONFIG.riskPerTrade),
      regime: s.regime,
      liqNote: s.liqNote,
      recordNote: notes[s.symbol],
    });
  }
}

/** Mark-to-market open trades against current prices and resolve terminal ones. */
export async function resolveOpen(
  priceBySymbol: Record<string, number>,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const keys = await r.smembers("sig:open");
  const now = Date.now();

  for (const key of keys) {
    const raw = await r.get<string>(key);
    if (!raw) {
      await r.srem("sig:open", key);
      continue;
    }
    const t: OpenTrade = typeof raw === "string" ? JSON.parse(raw) : raw;
    const p = priceBySymbol[t.symbol];
    if (p == null) continue;

    const favR = ((p - t.entry) * t.dir) / t.risk;
    t.mfe = Math.max(t.mfe, favR);
    t.mae = Math.min(t.mae, favR);

    const hitTarget = t.dir > 0 ? p >= t.target : p <= t.target;
    const hitStop = t.dir > 0 ? p <= t.stop : p >= t.stop;

    let outcome: "win" | "loss" | "expired" | null = null;
    let R = 0;
    if (hitTarget) {
      outcome = "win";
      R = Math.abs(t.target - t.entry) / t.risk;
    } else if (hitStop) {
      outcome = "loss";
      R = -1;
    } else if (now - t.ts > MAX_AGE_MS) {
      outcome = "expired";
      R = favR; // mark-to-market
    }

    if (!outcome) {
      t.lastR = Math.round(favR * 100) / 100; // unrealized R for the open view
      t.lastPrice = p;
      await r.set(key, JSON.stringify(t)); // persist updated mfe/mae + MTM
      continue;
    }

    await r.incr("sig:stat:trades");
    await r.incrbyfloat("sig:stat:sumR", R);
    await r.incr(`sig:stat:${outcome}`);
    await r.lpush(
      "sig:recent",
      JSON.stringify({
        symbol: t.symbol,
        dir: t.dir,
        outcome,
        R: Math.round(R * 100) / 100,
        rr: t.rr,
        riskPct: t.riskPct,
        sizeNotional: t.sizeNotional,
        mfe: Math.round(t.mfe * 100) / 100,
        mae: Math.round(t.mae * 100) / 100,
        regime: t.regime,
        openedAt: t.ts,
        resolvedAt: now,
      }),
    );
    // Keep a deep history, not just the 50 the UI shows: the risk-adjusted
    // metrics (Sharpe/Sortino/Calmar/max-DD) need the full per-trade series —
    // the sig:stat:* counters alone can't reconstruct an equity curve.
    await r.ltrim("sig:recent", 0, HISTORY_LIMIT - 1);
    await r.del(key);
    await r.srem("sig:open", key);

    // Notify: the tracked trade just closed (take-profit / stop / expired).
    await sendTradeExit({
      symbol: t.symbol,
      dir: t.dir,
      outcome,
      exitPrice: p,
      R: Math.round(R * 100) / 100,
      pnlUsd: Math.round(R * CONFIG.accountEquity * CONFIG.riskPerTrade),
    });
  }
}

/**
 * This symbol's MEASURED forward record, as one line for an alert.
 *
 * Replaces the old hard-coded "~60-70% historical winrate" note, which was never
 * measured and was contradicted by our own backtest. Every actionable alert now
 * carries what this signal has actually done — on this token — plus the standing
 * edge verdict. It updates itself as evidence accumulates, so the alert can
 * never again drift out of step with the truth.
 */
export async function forwardNotes(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const stats = await getStats();
  for (const sym of SYMBOLS) {
    const p = stats.perfBySymbol[sym];
    const record =
      !p || p.totalTrades === 0
        ? "Forward record: no closed trades yet for this token."
        : `Forward record (${sym}): ${p.totalTrades} closed · ${p.winRate ?? "—"}% win · ` +
          `${(p.expectancyR ?? 0) >= 0 ? "+" : ""}${p.expectancyR}R/trade` +
          (p.totalTrades < MIN_FWD_TRADES
            ? ` · too few to judge (need ${MIN_FWD_TRADES})`
            : (p.tStat ?? 0) >= stats.tBar
              ? ` · clears the t≥${stats.tBar} bar`
              : ` · not distinguishable from luck (t ${p.tStat})`);
    out[sym] = `${record}\n${EDGE_STATUS}`;
  }
  return out;
}

/** Aggregate the track record for display. */
export async function getStats(): Promise<JournalStats> {
  const riskUsd = CONFIG.accountEquity * CONFIG.riskPerTrade;
  const r = getRedis();
  if (!r) {
    return {
      fired: {},
      trades: 0,
      wins: 0,
      losses: 0,
      expired: 0,
      winRate: null,
      expectancyR: null,
      totalR: 0,
      startEquity: CONFIG.accountEquity,
      riskPerTrade: CONFIG.riskPerTrade,
      riskUsd,
      pnlUsd: 0,
      balanceUsd: CONFIG.accountEquity,
      perf: review([], CONFIG.riskPerTrade),
      perfBySymbol: {},
      tBar: tBarFor(SYMBOLS.length),
      recent: [],
      open: [],
    };
  }
  const [firedW, firedB, firedR, trades, wins, losses, expired, sumR, history, openKeys] =
    await Promise.all([
      r.get<number>("sig:fired:watch"),
      r.get<number>("sig:fired:break"),
      r.get<number>("sig:fired:retest"),
      r.get<number>("sig:stat:trades"),
      r.get<number>("sig:stat:win"),
      r.get<number>("sig:stat:loss"),
      r.get<number>("sig:stat:expired"),
      r.get<number>("sig:stat:sumR"),
      r.lrange("sig:recent", 0, HISTORY_LIMIT - 1),
      r.smembers("sig:open"),
    ]);

  const openRaw = openKeys.length
    ? await Promise.all(openKeys.map((k) => r.get<string>(k)))
    : [];
  const open = openRaw
    .filter((x) => x != null)
    .map((x) => (typeof x === "string" ? JSON.parse(x) : x));

  const w = wins ?? 0;
  const l = losses ?? 0;
  const n = trades ?? 0;
  const totalR = sumR ?? 0;

  const histParsed = history.map((x) => (typeof x === "string" ? JSON.parse(x) : x));
  // Compounding: risk riskPerTrade of the CURRENT balance each trade, over the
  // retained closed trades in chronological order.
  const chrono = [...histParsed].sort(
    (a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0),
  );
  let bal = CONFIG.accountEquity;
  for (const t of chrono) bal *= 1 + CONFIG.riskPerTrade * (t.R ?? 0);
  const balanceUsd = Math.round(bal);

  // Standardised review over the full retained history. Trades written before
  // timestamps existed are skipped rather than silently dated to the epoch.
  const usable = chrono.filter(
    (t) => t.openedAt != null && t.resolvedAt != null && t.R != null,
  );
  const toClosed = (ts: typeof usable): ClosedTrade[] =>
    ts.map((t) => ({ R: t.R, openedAt: t.openedAt, resolvedAt: t.resolvedAt }));

  // Per-token attribution. Every symbol gets its own review so each can earn
  // (or fail) its own tier — see docs/edge-criteria.md. Slicing k ways is k
  // shots at significance, so the UI must judge these against tBar, not 1.96.
  const perfBySymbol: Record<string, PerfReview> = {};
  for (const sym of SYMBOLS) {
    const forSym = usable.filter((t) => t.symbol === sym);
    if (forSym.length) perfBySymbol[sym] = review(toClosed(forSym), CONFIG.riskPerTrade);
  }

  return {
    perf: review(toClosed(usable), CONFIG.riskPerTrade),
    perfBySymbol,
    tBar: tBarFor(SYMBOLS.length),
    fired: { watch: firedW ?? 0, break: firedB ?? 0, retest: firedR ?? 0 },
    trades: n,
    wins: w,
    losses: l,
    expired: expired ?? 0,
    winRate: w + l > 0 ? Math.round((w / (w + l)) * 1000) / 10 : null,
    expectancyR: n > 0 ? Math.round((totalR / n) * 1000) / 1000 : null,
    totalR: Math.round(totalR * 100) / 100,
    startEquity: CONFIG.accountEquity,
    riskPerTrade: CONFIG.riskPerTrade,
    riskUsd: Math.round(balanceUsd * CONFIG.riskPerTrade),
    pnlUsd: balanceUsd - CONFIG.accountEquity,
    balanceUsd,
    recent: histParsed.slice(0, RECENT_SHOWN),
    open,
  };
}
