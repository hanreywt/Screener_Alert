# Methodology

The "why" behind the numbers. Implemented twice: Python (`volume_profile.py`,
`zones.py`, `signals.py`) and TypeScript (`web/src/lib/volumeProfile.ts`,
`zones.ts`, `signals.ts`, `roundLevels.ts`).

## Core idea

The strongest support/resistance is **where the most business got done**. We
fuse volume-at-price with price-action structure to score every zone 0–100.

## Building blocks (volume profile)

Built from the structural timeframe (default 1h × 500 candles):

- **POC (Point of Control)** — the single most-traded price bin. Strongest magnet.
- **Value Area (VAH / VAL)** — the price range containing 70% of traded volume.
  Its high/low edges act as S/R.
- **HVN / LVN** — High / Low Volume Nodes. HVN = acceptance (price spent time
  there → S/R). LVN = fast-move gaps (price rejects/accelerates through).

## Zone detection & scoring

1. **Swing pivots** — fractal highs/lows (`PIVOT_LOOKBACK` bars each side).
2. **Cluster** pivots within `CLUSTER_ATR_MULT × ATR` into a single zone band
   (half-width `ZONE_WIDTH_ATR × ATR`).
3. **Score 0–100** as a weighted blend (weights must sum to 1.0):

   | Factor | Signal | Weight |
   |---|---|---|
   | Volume-at-price | traded volume inside the zone's price bin | 0.30 |
   | Touch count | how many pivots respected the level | 0.22 |
   | Rejection | avg ATR-normalized wick rejection at the band | 0.20 |
   | Confluence | overlaps POC / VAH / VAL / HVN | 0.15 |
   | Recency | time-decayed activity | 0.13 |

4. **Tag** the zone (POC, VAH, VAL, HVN, LVN) for display and confluence.
5. Only zones ≥ `MIN_STRENGTH_ALERT` (default 55) are surfaced as signals.

## Signals

Evaluated on the trigger timeframe (default 5m × 120) for strong zones near price.

- **👀 watch** — price is within `PROXIMITY_ATR × ATR` of a zone whose strength
  is ≥ `watchMinStrength` (web default 70, higher than break/retest's 55 to keep
  the channel quiet — watch is a heads-up, not a trade).
- **💥 break** — the latest trigger candle closes through a zone by
  `≥ BREAK_ATR_MULT × ATR` on `≥ BREAK_VOL_MULT ×` average volume. The zone gets
  a **Break Rating (0–100)** = blend of volume expansion + decisiveness of the
  close-through. The zone flips (broken resistance → new support).
- **🎯 break-and-retest** — after a recent decisive break, price returns to the
  flipped zone within `RETEST_TOL_ATR × ATR`. Emits an entry with **stop /
  target / R:R**. Rule of thumb: only take if **R:R ≥ 1.5**. This is the
  highest-winrate structure (~60–70% in trending crypto).

## Regime filter (web only)

`web/src/lib/regime.ts`. Before emitting trade signals, classify the
higher-timeframe regime with **Kaufman's Efficiency Ratio** on the structural
timeframe:

`ER = |net change over N| / Σ|bar-to-bar change|` → 1 = clean trend, 0 = chop.

- `ER ≥ regimeMinEr` (0.3) → **trend_up / trend_down** (by net direction); else **range**.
- **Gating** (in `signals.ts`):
  - **retest** (break-and-retest is trend-following) fires *only* when the trade
    direction matches the trend — never in a range or counter-trend. This is the
    biggest live-vs-backtest gap-closer.
  - **break** fires when aligned with the trend, and is *also* allowed in a range
    (a range breakout is a valid trend start), but not counter-trend.
  - **watch** is informational — always allowed, just tagged with the regime.
- Every signal carries its `regime`, shown in the Discord embed and `/scan` card.
- `regimeMinEr` is a deliberate knob — validate it in a backtest.

## Round-number level alerts (web only)

`web/src/lib/roundLevels.ts`. Independent of zones. Alerts when a symbol
**crosses a psychological round level**, with direction.

- **Step size** per symbol via `ROUND_STEP` in `web/src/lib/config.ts`
  (BTC = 1000 → 62k, 63k, …). Omit a symbol to disable it.
- **Detection:** `bucket = floor(price / step)`. Compare to the last bucket
  stored in Redis (`rl:last:<symbol>`). A change = a crossing; direction from
  the sign. Handles multi-level jumps (62.4k → 64.1k alerts 63k and 64k).
- **First run** just sets the baseline (no alert).
- **Anti-flap via hysteresis:** a cross is only confirmed once price clears the
  level by `ROUND_HYSTERESIS × step` (default 3% = $30 on BTC). This mutes
  jitter right on the line while letting **every genuine re-cross alert — both
  directions, repeated** (62k up → 62k down → 62k up all fire). Implemented in
  `confirmBucket` (pure/testable); no time-based suppression.
- **Sampling limit:** price is checked once per cron run, so a round-trip that
  completes entirely between two runs isn't seen. Faster cadence narrows this.
- **Pure logic** (`computeCrosses`, `confirmBucket`) is unit-testable without Redis.

## Important caveats

- Public Binance data is delay-free but not exchange-official — treat as a
  **screener, not execution truth**.
- Not financial advice. Position sizing and final entries are the trader's.
