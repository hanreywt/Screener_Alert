# Edge Criteria — is a strategy "proven"?

Objective go/no-go thresholds a strategy must clear before it touches real
money. Written down on purpose: it removes wishful thinking and "the backtest
looks nice" from the decision. A strategy is only as proven as the tier it has
**earned** — never the tier we hope it's at.

> These bars are a reasonable retail-crypto standard, not gospel. Tune the
> numbers if you have a principled reason — but move the goalposts *before* you
> run the test, never after seeing the result.

## The tiers

| Tier | Meaning | Allowed to… |
|---|---|---|
| **0 — Not proven** | Fails any core gate below | Paper/journal + **discretionary** manual trading only |
| **1 — Candidate** | Passes all *backtest* gates | Forward paper-trade in the journal to confirm |
| **2 — Proven** | Backtest gates **and** forward-journal confirmation | Live with **tiny** size (≤0.25% risk/trade) |
| **3 — Scaling** | Live small-size matches paper | Scale size up gradually |

You cannot skip tiers. Live capital requires **Tier 2**.

## Gate A — Backtest (walk-forward, out-of-sample, net of costs)

All must pass, measured on the **out-of-sample** window in `research.ts`:

| Check | Bar | Why |
|---|---|---|
| OOS expectancy | **> +0.05 R/trade** (net fees+slippage) | Must clear a margin, not just beat zero |
| OOS sample size | **≥ 100 trades** (200+ preferred) | Small n = wide error bars |
| Statistical significance | **t-stat of per-trade R ≥ 2.0** | Edge distinguishable from luck (~95%) |
| Profit factor (OOS) | **≥ 1.2** | Survives real-world degradation |
| Walk-forward robustness | **positive in ≥ 3 of the folds** | Not one lucky window |
| Overfit check | **OOS expectancy ≥ 50% of in-sample** | IS≫OOS = curve-fit |
| Cost stress | **still positive at 1.5× fees+slippage** | Fills are never as good as modeled |
| Max drawdown | **≤ 25%** of R-equity | Survivable, not one-trade luck |
| Trial discipline | config chosen from a **capped grid** (multiple-testing aware) | Enough trials always "find" a fluke |

Fail any one → **Tier 0**, back to research.

## Gate B — Forward journal (before real money)

The un-overfittable check. Measured live in `/api/stats` / the Journal tab:

| Check | Bar |
|---|---|
| Forward resolved trades | **≥ 30** |
| Forward duration | **≥ 4 weeks** |
| Forward expectancy | **positive** and within ~1 std of the backtest |

Pass A **and** B → **Tier 2** (eligible for live, tiny size).

## Gate D — Per-symbol tiers (each token earns its own)

A strategy is not one thing across five tokens. Each symbol carries its own tier:
BTC may reach Tier 1 while TAO sits at Tier 0. The engine reports every metric
per symbol (`PER-SYMBOL EDGE` in `backtest.ts`, "Per-token edge" in the Journal).

**The multiple-testing tax.** Slicing one strategy across 5 symbols is 5 shots at
significance. With a coin-flip strategy, the *best of 5* slices clears the naive
t ≥ 2.0 bar far more often than 5% of the time — and it will always come with a
plausible story ("TAO is thin, so zones hold better"). To keep the family-wise
error at ~5%, the per-symbol bars are **raised**:

| Check | Pooled bar | Per-symbol bar (k=5) |
|---|---|---|
| t-stat of per-trade R | ≥ 2.0 | **≥ 2.58** (Bonferroni, `tBarFor(5)`) |
| OOS trades | ≥ 100 total | **≥ 100 for that symbol alone** |
| Walk-forward | positive in ≥3 folds | **positive in ≥3 folds for that symbol** |
| Forward journal | ≥ 30 trades | **≥ 30 for that symbol** |

A green per-symbol row is a **hypothesis, not an edge**. Promote it only by
re-running out-of-sample on that symbol alone, then confirming forward. Never
pick the winner *after* seeing the table and then quote its in-sample t-stat.

**Don't forward-test one token at a time.** Gate B needs ≥30 resolved trades and
≥4 weeks *per symbol*; run serially that's 5+ months. Keep all symbols firing in
parallel (the paper trades are independent) and slice in the *analysis*.

## Gate C — Live readiness (infrastructure & risk, separate from edge)

Edge is necessary but not sufficient. Before any live key is connected:

- Execution NOT on Vercel serverless — an always-on host in an **exchange-allowed
  region** (Binance/Bybit futures are geo-blocked from US/Vercel).
- API keys **trade-only** (no withdrawal), **IP-allowlisted**, not in a plain env var.
- Position sizing = fixed-fractional; a **max-drawdown kill-switch**; position
  reconciliation + fill tracking (use freqtrade/ccxt, not a cron function).
- Start at **≤0.25% risk/trade**; scale only after Tier 3 confirmation.

## Current status — 2026-07

**Tier 0 — NOT proven.** The break-and-retest strategy fails Gate A at the first
check. Standardised review, 12-month window, 763 trades, 15m profile, regime ON,
zone target, realistic fill, net of fees+slippage:

| | |
|---|---|
| Expectancy | **−0.271 R/trade** (bar: > +0.05) |
| t-stat | **−5.95** (bar: ≥ +2.0) |
| Profit factor | **0.63** (bar: ≥ 1.2) |
| Total return / CAGR | **−88.2% / −88.7%** @1% risk |
| Sharpe / Sortino / Calmar | **−4.89 / −5.69 / −1.0** |
| Max drawdown | **−88.4%** (bar: ≤ 25%) |
| Win rate | 34.2% — needs ~45% to break even at its 1.21 payoff |

The payoff ratio is *fine* (wins average 1.36R, losses 1.12R). It loses because
the win rate is far too low for that payoff. The MFE diagnosis (avg 1.05R, only
44% of trades reach +1R) says the **entry has no predictive edge** — no exit,
filter, or threshold tweak has changed this, and neither did sharpening the
volume profile (15m vs 1h: Δ −0.016R, t = −0.25, i.e. nothing).

**Gate D — per-symbol (12mo, k=5, bar t ≥ 2.58):** no token carries an edge.

| Symbol | n | Win | Expectancy | PF | Sharpe | t | Verdict |
|---|---|---|---|---|---|---|---|
| BTCUSDT | 190 | 35.8% | −0.335R | 0.58 | −3.27 | −3.61 | ❌ reliably negative |
| ETHUSDT | 144 | 31.9% | −0.323R | 0.58 | −2.92 | −3.03 | ❌ reliably negative |
| SOLUSDT | 138 | 28.3% | −0.362R | 0.53 | −3.41 | −3.52 | ❌ reliably negative |
| ONDOUSDT | 173 | 34.1% | −0.231R | 0.67 | −2.24 | −2.39 | — indistinguishable from luck |
| TAOUSDT | 118 | 41.5% | −0.059R | 0.90 | −0.53 | −0.52 | — indistinguishable from luck |

TAO is the least-bad slice — and that is **not** evidence it works. It is still
negative, its t-stat cannot be distinguished from zero, and it has the smallest
sample. Trading TAO on the strength of this row is exactly the mistake Gate D
exists to prevent.

→ **Allowed:** screener + Discord alerts + **manual discretionary** trading.
→ **Not allowed:** any mechanical/auto trading with real capital, on any symbol.

See [validation.md](validation.md) for the measurements behind this.
