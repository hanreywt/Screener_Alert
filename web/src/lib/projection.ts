import { getKlines, getPrice } from "./binance";
import { getRedis } from "./redisClient";
import seedRaw from "./data/btc-monthly-seed.json";

/**
 * BTC monthly return history + forward scenario projection.
 *
 * History is stitched from two sources so it reaches back to the 2013 cycle,
 * which Binance does not cover:
 *   - 2013-01 .. 2017-07  → committed static seed (Bitstamp BTC/USD month-end
 *     closes; see data/btc-monthly-seed.json). Never fetched at runtime.
 *   - 2017-08 .. now       → Binance 1M candles, fetched live.
 *
 * The forward projection is SCENARIO ANALYSIS, not a forecast. Two lenses:
 *   - "all"   — future months are drawn from the whole return history.
 *   - "cycle" — future months are drawn from the matching HALVING-cycle phase
 *     (year 1–4 since the last halving). BTC's 4-year halving rhythm is the
 *     strongest seasonal structure in the data, but we only have ~3 completed
 *     cycles, so each phase bucket is a thin sample — treat cycle mode as a
 *     narrative overlay, not precision.
 *
 * The Monte Carlo RNG is seeded by calendar month so the fan is stable within a
 * month (same picture on every refresh) and only moves when a new candle closes.
 */

export interface MonthPoint {
  time: number; // month-open, unix seconds (UTC)
  close: number;
}

const SEED = seedRaw as MonthPoint[];

// Boundary: seed stops here; Binance owns everything strictly after this month.
const BINANCE_START = SEED[SEED.length - 1].time + 1;

/** BTC halving dates (UTC). The 5th (~2028) is estimated for forward labelling. */
const HALVINGS = [
  Date.UTC(2012, 10, 28),
  Date.UTC(2016, 6, 9),
  Date.UTC(2020, 4, 11),
  Date.UTC(2024, 3, 20),
];
const NEXT_HALVING_EST = Date.UTC(2028, 3, 1);

const PHASE_LABEL = [
  "halving year (accumulation → early bull)",
  "post-halving year (blow-off / peak)",
  "corrective year (post-peak drawdown)",
  "pre-halving year (recovery)",
];

/** Number of forward paths in the Monte Carlo. */
const SIMS = 10_000;
/** Horizons rendered on the page (months forward). */
export const HORIZONS = [12, 24] as const;
export type Horizon = (typeof HORIZONS)[number];
export type Mode = "all" | "cycle";

export interface Band {
  time: number; // month-open, unix seconds
  p10: number;
  p50: number;
  p90: number;
}
export interface ScenarioLine {
  time: number;
  value: number;
}
export interface Bands {
  fan: Band[]; // Monte Carlo percentile cone, month by month
  bull: ScenarioLine[]; // compounding the p75 monthly return of each month's pool
  base: ScenarioLine[]; // p50
  bear: ScenarioLine[]; // p25
  end: { p10: number; p50: number; p90: number; bull: number; base: number; bear: number };
}
export interface HorizonProjection {
  months: number;
  all: Bands;
  cycle: Bands;
}
export interface CycleBucket {
  year: number; // 1..4 (years since last halving)
  label: string;
  n: number; // month-observations in this bucket
  meanPct: number;
  medianPct: number;
  medianAnnPct: number;
}
export interface CurrentMonth {
  time: number; // forming month-open, unix seconds
  open: number; // this month's opening price (fixed for the month)
  monthToDateReturn: number | null; // live MTD return (fraction); null if unavailable
  livePrice: number | null; // latest price used for the MTD figure
}
export interface Projection {
  generatedAt: number;
  monthKey: string; // YYYY-MM this was computed for (cache + stability key)
  spot: number; // latest monthly close, the projection origin
  history: MonthPoint[]; // full stitched monthly closes
  current: CurrentMonth | null; // the still-forming month, refreshed live per request
  stats: {
    months: number; // sample size (monthly returns)
    firstDate: number;
    meanPct: number; // mean monthly return, %
    stdPct: number; // std of monthly return, %
    bestPct: number; // best single month, %
    worstPct: number; // worst single month, %
    p25MoPct: number; // all-history monthly quartiles (unconditional scenario basis)
    p50MoPct: number;
    p75MoPct: number;
  };
  cycle: {
    monthsSinceHalving: number;
    cycleYear: number; // 1..4
    phaseLabel: string;
    lastHalving: number; // unix seconds
    nextHalvingEst: number; // unix seconds
    buckets: CycleBucket[];
  };
  horizons: Record<number, HorizonProjection>;
}

/** Deterministic PRNG (mulberry32) so a given month always renders the same fan. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function monthKeyOf(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Unix seconds of the month-open `n` calendar months after `ts`. */
function addMonths(ts: number, n: number): number {
  const d = new Date(ts * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) / 1000);
}

/** True once the calendar month opened at `ts` has fully elapsed. */
function monthClosed(ts: number, now: number): boolean {
  return addMonths(ts, 1) * 1000 <= now;
}

/** YYYY-MM of the most recent fully-closed month, from the wall clock alone. */
function lastClosedMonthKey(now: number): string {
  const d = new Date(now);
  return monthKeyOf(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) / 1000));
}

/** Whole months from the most recent halving at/before `ms`, or null if before the first. */
function monthsSinceHalving(ms: number): number | null {
  let last: number | null = null;
  for (const h of HALVINGS) if (h <= ms) last = h;
  if (last == null) return null;
  const a = new Date(last);
  const b = new Date(ms);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/** Halving-cycle year bucket 0..3 for a timestamp (ms), or null if pre-first-halving. */
function cycleBucket(ms: number): number | null {
  const m = monthsSinceHalving(ms);
  if (m == null) return null;
  return Math.min(Math.floor(m / 12), 3);
}

interface Forming {
  time: number;
  open: number;
  close: number;
}

/**
 * Stitched monthly closes (static seed + live Binance monthly candles) plus the
 * still-forming current month, returned separately. Closed months feed the
 * distribution and the fan; the forming month is never mixed into returns (it
 * would be a partial candle) but powers the live "current month" cell.
 */
async function fetchMonthly(): Promise<{ closed: MonthPoint[]; forming: Forming | null }> {
  const raw = await getKlines("BTCUSDT", "1M", 200);
  const now = Date.now();
  const closedBinance: MonthPoint[] = raw
    .filter((c) => monthClosed(c.time, now) && c.time >= BINANCE_START)
    .map((c) => ({ time: c.time, close: c.close }));
  const formingRaw = raw
    .filter((c) => !monthClosed(c.time, now))
    .sort((a, b) => a.time - b.time)
    .pop();
  const forming: Forming | null = formingRaw
    ? { time: formingRaw.time, open: formingRaw.open, close: formingRaw.close }
    : null;
  const closed = [...SEED.map((s) => ({ time: s.time, close: s.close })), ...closedBinance];
  return { closed, forming };
}

/** A pool of returns to draw a forward month from: log-returns for the MC, quartiles for the lines. */
interface Pool {
  logRets: number[];
  q25: number; // simple return
  q50: number;
  q75: number;
}

function poolOf(simpleRets: number[]): Pool {
  const logRets = simpleRets.map((r) => Math.log(1 + r));
  const sorted = simpleRets.slice().sort((a, b) => a - b);
  return {
    logRets,
    q25: percentile(sorted, 0.25),
    q50: percentile(sorted, 0.5),
    q75: percentile(sorted, 0.75),
  };
}

/**
 * Build the fan + scenario lines for one horizon. `poolFor(m)` supplies the
 * return pool for forward month m (0-indexed) — the same all-history pool every
 * month in "all" mode, or the matching halving-phase bucket in "cycle" mode, so
 * the cone and lines bend as the forward window crosses cycle phases.
 */
function buildBands(
  months: number,
  spot: number,
  lastTime: number,
  poolFor: (m: number) => Pool,
  rand: () => number,
): Bands {
  const futureTimes = Array.from({ length: months }, (_, m) => addMonths(lastTime, m + 1));
  const pools = Array.from({ length: months }, (_, m) => poolFor(m));

  const perMonth: number[][] = Array.from({ length: months }, () => new Array(SIMS));
  for (let s = 0; s < SIMS; s++) {
    let level = spot;
    for (let m = 0; m < months; m++) {
      const lr = pools[m].logRets;
      level *= Math.exp(lr[Math.floor(rand() * lr.length)]);
      perMonth[m][s] = level;
    }
  }

  const fan: Band[] = [];
  for (let m = 0; m < months; m++) {
    const col = perMonth[m].slice().sort((a, b) => a - b);
    fan.push({
      time: futureTimes[m],
      p10: percentile(col, 0.1),
      p50: percentile(col, 0.5),
      p90: percentile(col, 0.9),
    });
  }

  // Scenario lines: compound each forward month's quartile rate. In "cycle" mode
  // the quartiles change month to month with the phase, so the lines are shaped,
  // not straight. Quartiles (not the tails) keep a lone +450% month from blowing
  // the bull line to absurdity.
  const line = (pick: (p: Pool) => number): ScenarioLine[] => {
    const out: ScenarioLine[] = [];
    let level = spot;
    for (let m = 0; m < months; m++) {
      level *= 1 + pick(pools[m]);
      out.push({ time: futureTimes[m], value: level });
    }
    return out;
  };
  const bull = line((p) => p.q75);
  const base = line((p) => p.q50);
  const bear = line((p) => p.q25);

  const last = fan[fan.length - 1];
  return {
    fan,
    bull,
    base,
    bear,
    end: {
      p10: last.p10,
      p50: last.p50,
      p90: last.p90,
      bull: bull[bull.length - 1].value,
      base: base[base.length - 1].value,
      bear: bear[bear.length - 1].value,
    },
  };
}

function compute(history: MonthPoint[], forming: Forming | null): Projection {
  const closes = history.map((h) => h.close);
  const last = history[history.length - 1];
  const spot = last.close;
  const monthKey = monthKeyOf(last.time);

  // Monthly simple returns, each tagged with the month it lands in.
  const rets: { r: number; time: number; bucket: number | null }[] = [];
  for (let i = 1; i < closes.length; i++) {
    rets.push({
      r: closes[i] / closes[i - 1] - 1,
      time: history[i].time,
      bucket: cycleBucket(history[i].time * 1000),
    });
  }
  const simpleRets = rets.map((x) => x.r);
  const sortedSimple = simpleRets.slice().sort((a, b) => a - b);

  const mean = simpleRets.reduce((a, b) => a + b, 0) / simpleRets.length;
  const variance =
    simpleRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (simpleRets.length - 1);
  const std = Math.sqrt(variance);

  const allPool = poolOf(simpleRets);

  // Per-halving-phase pools. Fall back to the all-history pool for any thin/empty
  // bucket so the projection never samples an empty set.
  const bucketPools: Pool[] = [];
  const buckets: CycleBucket[] = [];
  for (let b = 0; b < 4; b++) {
    const rs = rets.filter((x) => x.bucket === b).map((x) => x.r);
    bucketPools[b] = rs.length >= 6 ? poolOf(rs) : allPool;
    const med = rs.length ? percentile(rs.slice().sort((a, c) => a - c), 0.5) : NaN;
    buckets.push({
      year: b + 1,
      label: PHASE_LABEL[b],
      n: rs.length,
      meanPct: rs.length ? (rs.reduce((a, c) => a + c, 0) / rs.length) * 100 : NaN,
      medianPct: med * 100,
      medianAnnPct: (Math.pow(1 + med, 12) - 1) * 100,
    });
  }

  const seedNum = last.time % 2_147_483_647;
  const allPoolFor = () => allPool;

  const horizons: Record<number, HorizonProjection> = {};
  for (const h of HORIZONS) {
    const cyclePoolFor = (m: number) => {
      const b = cycleBucket(addMonths(last.time, m + 1) * 1000);
      return b == null ? allPool : bucketPools[b];
    };
    horizons[h] = {
      months: h,
      all: buildBands(h, spot, last.time, allPoolFor, mulberry32(seedNum + h)),
      cycle: buildBands(h, spot, last.time, cyclePoolFor, mulberry32(seedNum + h + 777)),
    };
  }

  const msh = monthsSinceHalving(last.time * 1000) ?? 0;
  const cycleYear = Math.min(Math.floor(msh / 12), 3);
  let lastHalving = HALVINGS[0];
  for (const hv of HALVINGS) if (hv <= last.time * 1000) lastHalving = hv;

  return {
    generatedAt: Date.now(),
    monthKey,
    spot,
    history,
    current: forming
      ? {
          time: forming.time,
          open: forming.open,
          // Seeded from the forming candle at fetch time; getProjection overlays
          // a fresh live price so a warm cache still shows a live MTD figure.
          monthToDateReturn: forming.open ? forming.close / forming.open - 1 : null,
          livePrice: forming.close,
        }
      : null,
    stats: {
      months: simpleRets.length,
      firstDate: history[0].time,
      meanPct: mean * 100,
      stdPct: std * 100,
      bestPct: sortedSimple[sortedSimple.length - 1] * 100,
      worstPct: sortedSimple[0] * 100,
      p25MoPct: allPool.q25 * 100,
      p50MoPct: allPool.q50 * 100,
      p75MoPct: allPool.q75 * 100,
    },
    cycle: {
      monthsSinceHalving: msh,
      cycleYear: cycleYear + 1,
      phaseLabel: PHASE_LABEL[cycleYear],
      lastHalving: Math.floor(lastHalving / 1000),
      nextHalvingEst: Math.floor(NEXT_HALVING_EST / 1000),
      buckets,
    },
    horizons,
  };
}

const CACHE_KEY = "projection:btc:v2";

/**
 * Cached projection. The heavy part is the Binance monthly fetch (~20s in some
 * regions); the result only changes when a new month closes, so we cache the
 * full computed payload in Redis keyed by month and recompute on rollover. The
 * cache-freshness check reads the wall clock (no Binance call), so a cache hit
 * costs one Redis GET and nothing else. Degrades gracefully (recompute every
 * call) when Redis is unconfigured.
 */
export async function getProjection(): Promise<Projection> {
  const redis = getRedis();
  const wantKey = lastClosedMonthKey(Date.now());

  let projection: Projection | null = null;
  if (redis) {
    const cached = (await redis.get(CACHE_KEY)) as Projection | null;
    if (cached && cached.monthKey === wantKey) projection = cached;
  }

  if (!projection) {
    const { closed, forming } = await fetchMonthly();
    projection = compute(closed, forming);
    if (redis) await redis.set(CACHE_KEY, projection, { ex: 60 * 60 * 24 * 45 });
  }

  // Refresh the current-month MTD live (best-effort, never cached). The month's
  // open is fixed, so a live price alone updates the figure — the heavy fan
  // stays served from cache.
  if (projection.current?.open) {
    try {
      const live = await getPrice("BTCUSDT");
      projection = {
        ...projection,
        current: {
          ...projection.current,
          livePrice: live,
          monthToDateReturn: live / projection.current.open - 1,
        },
      };
    } catch {
      // keep the cached/computed current-month figure
    }
  }

  return projection;
}
