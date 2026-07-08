# Validation — does the strategy actually work?

Two independent ways to measure edge, so we stop trading on faith.

## 1. Live signal journal (forward track record)

`web/src/lib/journal.ts`, surfaced at `GET /api/stats` (behind the auth gate).

When a **retest** fires, the cron alerter opens a paper trade (entry/stop/target)
in Redis. On later runs it marks-to-market against price and resolves each as
**win / loss / expired**, keeping running aggregates:

- `sig:fired:<kind>` — how often each signal type fires
- `sig:stat:trades|win|loss|expired|sumR` — resolved outcomes
- `sig:recent` — last 50 resolved trades (with MFE/MAE in R)

`/api/stats` returns trades, win rate, and **expectancy in R**. This is an
honest, un-overfittable, forward record — it accrues over time as signals fire.
Prices are sampled per cron run, so intrabar fills aren't exact (the backtest is
candle-accurate); treat this as a directional live validator.

## 2. Backtest harness (historical, bulk sample)

`web/scripts/backtest.ts` — run locally, reuses the **exact live logic** in
`src/lib` (zones, regime, signals) so there's no drift. Look-ahead-safe: each
step only sees candles that had closed by then. Costs (fee + slippage) applied
round-trip. Compares the regime filter ON vs OFF.

```bash
cd web
MONTHS=3 npx tsx scripts/backtest.ts
MONTHS=6 SYMBOLS=BTCUSDT,ETHUSDT npx tsx scripts/backtest.ts
```

Reports per mode: trades, win rate, expectancy (R), profit factor, max drawdown.

### Modeling assumptions (read before trusting the number)
- **Conservative fills:** if a 5m candle touches both stop and target, it's
  counted a **loss** (stop-first). This biases results *pessimistic* for tight
  stops — real fills may be kinder.
- **Costs:** 0.1% round-trip fee + 0.04% slippage. No funding (spot model).
- **Exit:** target / stop / timeout (`TIMEOUT_BARS`, ~8h on 5m) at MTM.
- A short window is one specific market regime — not a full-cycle verdict.

## Result (3-month, all symbols, 1h/5m) — 2026-07

**Fill model** — pessimistic (stop-first) vs realistic (nearer-to-open first)
were **identical** (−0.255 R). Same-bar double-touches are rare here, so the
conservative assumption was *not* biasing results. The loss is real.

**Regime filter** (zone target, realistic fill):

| | Regime ON | Regime OFF |
|---|---|---|
| Trades | 338 | 2247 |
| Win rate | 51% | 54% |
| **Expectancy** | **−0.255 R** | **−0.171 R** |
| Profit factor | 0.54 | 0.67 |

**Exit sweep** (regime ON) — every exit rule loses:

| Exit | Win% | Expectancy |
|---|---|---|
| zone target | 51% | −0.255 R |
| fixed 1R | 48% | −0.234 R |
| fixed 1.5R | 33% | −0.290 R |
| fixed 2R | 25% | −0.294 R |
| fixed 3R | 15% | −0.270 R |
| 2R + breakeven@1R | 19% | −0.275 R |

### 🔑 Diagnosis: it's the ENTRY, not the exit

**Average MFE = 0.74 R; only 22% of trades ever reach +1R in favor before
exiting.** Trades, on average, don't even move one risk-unit in your favor
before reversing. No exit rule can harvest a profit the trade never reaches —
which is exactly why every exit variant loses. **The retest entry signal has no
predictive edge here.** Tuning exits, filters, or fills is rearranging deck
chairs; the problem is upstream, in what the entry selects.

**Conclusions:**
- README's "60–70% win rate" is **false** — actual ≈ 51%, a coin flip.
- **Negative expectancy net of costs**, robust across fill models, regime on/off,
  and all exit rules. Do **not** trade this mechanically.
- The regime filter does not add edge (slightly worse per-trade).

## Walk-forward (train/test) with risk control — 2026-07

`web/scripts/research.ts`. 12 months, 67% train / 33% out-of-sample, 18-config
grid (capped to limit multiple-testing), fixed-fractional sizing (1%/trade) with
a 20% drawdown circuit breaker.

- **Every config is negative on the training set.** The proper process (pick the
  best config *on train*, judge it *on test*) selected `str≥55 / regime on /
  exit 1R` → **OOS expectancy −0.152 R** over 547 unseen trades. Risk-controlled
  equity: **−5.1%**, maxDD −20.9%, and the **drawdown circuit breaker tripped**.

- **⚠️ The overfitting trap this caught:** `str≥80 / regime on` looked *positive*
  out-of-sample (+0.06 to +0.17 R) — but it was **negative on train** (−0.22 to
  −0.36 R) and only 60 test trades. A naive backtester would cherry-pick it and
  blow up live; the train/test discipline correctly **refuses to select it**,
  because you couldn't have known in advance and the sample is noise-sized. This
  is *why* the methodology exists — it blocked a false positive.

**Final verdict: no tradable mechanical edge.** 12 months (larger sample than the
3-month run) confirms the negative expectancy, and a rigorous train/test process
finds nothing that generalizes. Risk control contained the damage but can't
create edge.

## Where to take it next
Because the diagnosis points at the **entry**, exit/filter tuning is futile.
Real options:
1. **Rethink the entry hypothesis** — the current retest trigger isn't
   predictive. Candidates to test the *same rigorous way*: only the very
   strongest zones (strength ≫ 55), multi-timeframe confluence, volume-delta
   confirmation, or a different trigger entirely. Each is a new hypothesis — and
   with avg MFE 0.74R the base is weak, so beware small-sample overfitting.
2. **Test a different edge** — POC/HVN mean-reversion, or the break momentum
   itself, measured with this same harness.
3. **Keep it as a discretionary screener** — surfacing levels for a human to
   judge is legitimate and unaffected by this; just don't automate trading.

Caveats: 3 months is one regime; 4 highly-correlated symbols; spot-only. Longer,
multi-cycle history could differ — but the MFE finding is structural, not a
threshold artifact.
