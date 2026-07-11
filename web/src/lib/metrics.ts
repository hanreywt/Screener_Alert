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
  daysToRatios: number; // days left before Sharpe/Sortino are meaningful (0 = now)
  daysToAnnualise: number; // days left before CAGR/Calmar are meaningful
}

const DAY_MS = 864e5;
const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

/**
 * Minimum calendar span before a time-scaled metric is allowed to speak.
 *
 * These exist because annualising a short window is not a metric, it's a rumour:
 * a -1.0% loss over 3 days compounds to a "-70.9% CAGR", and a Sharpe built from
 * 3 daily returns is pure noise. The live journal starts empty and sits in that
 * regime for weeks, so without these gates the dashboard would spend its first
 * month reporting numbers that look authoritative and mean nothing.
 *
 * Below the gate we return null and the UI renders "—". Untouched metrics
 * (total return, max DD, expectancy, PF, win rate) are NOT extrapolations and
 * stay honest at any sample size.
 */
const MIN_DAYS_RATIO = 30; // Sharpe / Sortino: need enough daily observations
const MIN_DAYS_ANNUALISE = 60; // CAGR / Calmar: need enough window to project a year

const EMPTY: PerfReview = {
  totalTrades: 0, winRate: null, expectancyR: null, profitFactor: null,
  avgWinR: null, avgLossR: null, payoffRatio: null, tStat: null,
  totalReturnPct: null, annualisedReturnPct: null, maxDrawdownPct: null,
  sharpe: null, sortino: null, calmar: null,
  avgTradeDurationHours: null, tradingDays: 0,
  daysToRatios: MIN_DAYS_RATIO, daysToAnnualise: MIN_DAYS_ANNUALISE,
};

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
  // And it stays silent until the window is long enough to project from at all.
  const cagr =
    days >= MIN_DAYS_ANNUALISE && years > 0 && finalEq > 0
      ? (finalEq ** (1 / years) - 1) * 100
      : null;

  const muD = mean(returns);
  const sdD = stdev(returns, muD);
  const ddD = downsideDev(returns);
  const ann = Math.sqrt(365); // daily → annual, rf = 0
  const ratiosOk = days >= MIN_DAYS_RATIO;

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
    sharpe: ratiosOk && sdD > 0 ? round((muD / sdD) * ann, 2) : null,
    sortino: ratiosOk && ddD > 0 ? round((muD / ddD) * ann, 2) : null,
    calmar: cagr != null && maxDd < 0 ? round(cagr / Math.abs(maxDd * 100), 2) : null,

    avgTradeDurationHours: round(durH, 1),
    tradingDays: days,
    daysToRatios: Math.max(0, MIN_DAYS_RATIO - days),
    daysToAnnualise: Math.max(0, MIN_DAYS_ANNUALISE - days),
  };
}

/**
 * Bonferroni-adjusted t bar for judging the BEST of `k` slices.
 *
 * Slicing one strategy across 5 symbols is 5 shots at significance, so the
 * winner clears t=2.0 by luck far more often than the nominal 5% suggests. To
 * keep the family-wise error at ~5% each slice must clear the α/k quantile.
 * Normal approximation — fine at the sample sizes we care about (n ≥ 30).
 */
export function tBarFor(k: number, alpha = 0.05): number {
  if (k <= 1) return 1.96;
  // Inverse normal CDF (Acklam's rational approximation, |ε| < 1.15e-9).
  const p = 1 - alpha / (2 * k); // two-sided, split across k tests
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
             138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
             66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
             -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  let q: number, r: number, x: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
         ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return round(x, 2);
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
