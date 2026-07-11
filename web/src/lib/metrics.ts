/**
 * Standardised performance review — ONE implementation, used by both the
 * backtest and the live journal, so a number means the same thing in both.
 *
 * Two families of metric here, and it matters which you quote:
 *
 *   • R-space (expectancy, profit factor, avg win/loss, win rate) — unitless,
 *     independent of position sizing. This is where the *edge* lives.
 *   • Money-space (total/annualised return, Sharpe, Sortino, Calmar, max DD %)
 *     — these depend on `riskPerTrade`. Halve the risk and Sharpe barely moves
 *     but total return does. Never compare money-space numbers across configs
 *     with different sizing.
 *
 * Risk-adjusted ratios are computed on a DAILY equity curve, not on per-trade
 * returns: trades are lumpy and clustered, and a per-trade Sharpe silently
 * rewards a strategy that simply trades less often. Calendar days with no
 * trades count as 0% — that's deliberate, it's what a real account experiences.
 */

export interface ClosedTrade {
  R: number; // realised result in R (risk multiples), net of costs
  openedAt: number; // ms epoch
  resolvedAt: number; // ms epoch
}

export interface PerfReview {
  // --- edge (R-space, sizing-independent) ---
  totalTrades: number;
  winRate: number | null; // % of wins over wins+losses
  expectancyR: number | null; // mean R per trade
  profitFactor: number | null; // gross win R / gross loss R
  avgWinR: number | null;
  avgLossR: number | null; // negative
  payoffRatio: number | null; // avgWin / |avgLoss|
  tStat: number | null; // expectancy vs zero — is it luck?

  // --- money (depends on riskPerTrade) ---
  totalReturnPct: number | null; // compounded, over the whole window
  annualisedReturnPct: number | null; // CAGR
  maxDrawdownPct: number | null; // peak-to-trough on the equity curve
  sharpe: number | null; // annualised, rf = 0
  sortino: number | null; // annualised, downside deviation only
  calmar: number | null; // CAGR / |maxDD|

  // --- shape ---
  avgTradeDurationHours: number | null;
  tradingDays: number; // calendar span of the window
}

const EMPTY: PerfReview = {
  totalTrades: 0, winRate: null, expectancyR: null, profitFactor: null,
  avgWinR: null, avgLossR: null, payoffRatio: null, tStat: null,
  totalReturnPct: null, annualisedReturnPct: null, maxDrawdownPct: null,
  sharpe: null, sortino: null, calmar: null,
  avgTradeDurationHours: null, tradingDays: 0,
};

const DAY_MS = 864e5;
const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

/**
 * Build a daily equity curve by compounding `riskPerTrade` of the running
 * balance per trade, then filling every calendar day in the span (flat on days
 * with no exits). Returns the curve plus its daily percentage returns.
 */
function dailyCurve(trades: ClosedTrade[], riskPerTrade: number) {
  const sorted = [...trades].sort((a, b) => a.resolvedAt - b.resolvedAt);
  const first = Math.floor(sorted[0].resolvedAt / DAY_MS);
  const last = Math.floor(sorted[sorted.length - 1].resolvedAt / DAY_MS);

  // Bucket each trade's multiplier onto the day it closed.
  const byDay = new Map<number, number>();
  for (const t of sorted) {
    const d = Math.floor(t.resolvedAt / DAY_MS);
    byDay.set(d, (byDay.get(d) ?? 1) * (1 + riskPerTrade * t.R));
  }

  const equity: number[] = [];
  const returns: number[] = [];
  let bal = 1;
  for (let d = first; d <= last; d++) {
    const mult = byDay.get(d) ?? 1;
    const prev = bal;
    bal *= mult;
    equity.push(bal);
    returns.push(prev > 0 ? bal / prev - 1 : 0);
  }
  return { equity, returns, days: last - first + 1 };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function stdev(xs: number[], mu = mean(xs)): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1));
}

/** Downside deviation: only returns below the target (0) contribute. */
function downsideDev(xs: number[], target = 0): number {
  if (xs.length < 2) return 0;
  const sq = xs.reduce((a, x) => a + (x < target ? (x - target) ** 2 : 0), 0);
  return Math.sqrt(sq / (xs.length - 1));
}

export function review(trades: ClosedTrade[], riskPerTrade: number): PerfReview {
  const n = trades.length;
  if (n === 0) return EMPTY;

  // --- R-space ---------------------------------------------------------
  const Rs = trades.map((t) => t.R);
  const wins = Rs.filter((r) => r > 0);
  const losses = Rs.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const expectancyR = mean(Rs);
  const sd = stdev(Rs, expectancyR);
  const tStat = sd > 0 ? expectancyR / (sd / Math.sqrt(n)) : 0;

  const avgWinR = wins.length ? mean(wins) : null;
  const avgLossR = losses.length ? mean(losses) : null;

  // --- money-space -----------------------------------------------------
  const { equity, returns, days } = dailyCurve(trades, riskPerTrade);
  const finalEq = equity[equity.length - 1];

  let peak = equity[0];
  let maxDd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDd = Math.min(maxDd, e / peak - 1); // negative
  }

  const years = days / 365;
  // CAGR is undefined if the account is wiped out; guard the fractional power.
  const cagr =
    years > 0 && finalEq > 0 ? (finalEq ** (1 / years) - 1) * 100 : null;

  const muD = mean(returns);
  const sdD = stdev(returns, muD);
  const ddD = downsideDev(returns);
  const ann = Math.sqrt(365); // daily → annual, rf = 0

  const durH = mean(trades.map((t) => (t.resolvedAt - t.openedAt) / 36e5));

  return {
    totalTrades: n,
    winRate: wins.length + losses.length > 0
      ? round((wins.length / (wins.length + losses.length)) * 100, 1)
      : null,
    expectancyR: round(expectancyR),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    avgWinR: avgWinR != null ? round(avgWinR, 2) : null,
    avgLossR: avgLossR != null ? round(avgLossR, 2) : null,
    payoffRatio:
      avgWinR != null && avgLossR != null && avgLossR !== 0
        ? round(avgWinR / Math.abs(avgLossR), 2)
        : null,
    tStat: round(tStat, 2),

    totalReturnPct: round((finalEq - 1) * 100, 2),
    annualisedReturnPct: cagr != null ? round(cagr, 2) : null,
    maxDrawdownPct: round(maxDd * 100, 2),
    sharpe: sdD > 0 ? round((muD / sdD) * ann, 2) : null,
    sortino: ddD > 0 ? round((muD / ddD) * ann, 2) : null,
    calmar: cagr != null && maxDd < 0 ? round(cagr / Math.abs(maxDd * 100), 2) : null,

    avgTradeDurationHours: round(durH, 1),
    tradingDays: days,
  };
}

/** Fixed-width console block — same field order everywhere it's printed. */
export function formatReview(label: string, m: PerfReview): string {
  const f = (v: number | null, suffix = "") =>
    v == null ? "—".padStart(8) : `${v}${suffix}`.padStart(8);
  return [
    `  ${label}`,
    `    trades ${f(m.totalTrades)}   win ${f(m.winRate, "%")}   expectancy ${f(m.expectancyR, "R")}   PF ${f(m.profitFactor)}`,
    `    avgWin ${f(m.avgWinR, "R")}   avgLoss ${f(m.avgLossR, "R")}   payoff ${f(m.payoffRatio)}   t ${f(m.tStat)}`,
    `    return ${f(m.totalReturnPct, "%")}   CAGR ${f(m.annualisedReturnPct, "%")}   maxDD ${f(m.maxDrawdownPct, "%")}`,
    `    Sharpe ${f(m.sharpe)}   Sortino ${f(m.sortino)}   Calmar ${f(m.calmar)}   avgDur ${f(m.avgTradeDurationHours, "h")}`,
  ].join("\n");
}
