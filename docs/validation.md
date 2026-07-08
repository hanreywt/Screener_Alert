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

## First result (3-month, all symbols, 1h/5m) — 2026-07

| | Regime ON (live) | Regime OFF |
|---|---|---|
| Trades | 365 | 2673 |
| Win rate | 50.9% | 53.5% |
| **Expectancy** | **−0.255 R** | **−0.176 R** |
| Profit factor | 0.55 | 0.66 |

**Takeaways (honest):**
- The README's "~60–70% win rate" is **not supported** — actual ≈ 51–54%.
- **Negative expectancy net of costs** in both modes → as configured, this is a
  losing mechanical system. Do **not** trade it live as-is.
- The regime filter cut trade count ~7× but did **not** improve per-trade
  expectancy on this window — it reduces activity, not (yet) loss rate.
- Caveat: the conservative same-bar stop-first rule drags results down; a more
  realistic fill model and parameter work could shift this. But there's no
  evidence of a real edge here to build on yet.

## Where to take it next
1. Decompose *why* it loses: realized R vs intended R:R, timeout drag, stop
   placement. Relax the same-bar assumption and re-check.
2. Parameter sweeps (thresholds/weights/`regimeMinEr`) with **walk-forward** to
   avoid curve-fitting; longer/multi-regime history.
3. Test alternative edges: the break itself, POC/HVN mean-reversion, MTF
   confluence — measured the same way before shipping.
4. Meanwhile the screener is fine as a **discretionary** aid (human judgment
   added); just don't automate trading on it until a positive-expectancy,
   walk-forward-validated configuration exists.
