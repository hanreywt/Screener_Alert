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
check: **OOS expectancy is negative** (−0.15 to −0.25 R across 3-month and
12-month walk-forward), win rate ~51% (coin-flip), and the MFE diagnosis
(avg 0.74R) shows the *entry* has no predictive edge. No exit/filter/threshold
tweak changed this.

→ **Allowed:** screener + Discord alerts + **manual discretionary** trading.
→ **Not allowed:** any mechanical/auto trading with real capital.

See [validation.md](validation.md) for the measurements behind this.
