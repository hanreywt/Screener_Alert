# Support/Resistance Engine

**A volume-weighted support/resistance & break-and-retest system for crypto — that I backtested rigorously and honestly measured as having _no tradable edge_.**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Upstash Redis](https://img.shields.io/badge/Upstash-Redis-00E9A3?logo=redis&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)

Most trading-bot projects show you a beautiful equity curve and ask you to trust
it. This one does the opposite: it builds a serious, well-motivated strategy,
subjects it to an honest walk-forward backtest, and **reports the verdict even
when the verdict is "this doesn't work."** The out-of-sample expectancy is
**−0.27R per trade** (t = −5.95 over 763 trades). No cherry-picking, no
overfit curve — just the measurement, surfaced on every alert.

That honesty _is_ the project. It's a study in doing quantitative research
properly: forming a hypothesis, testing it out-of-sample, correcting for
multiple comparisons, and refusing to overstate the result.

<!-- ⚠️ ADD A SCREENSHOT/GIF HERE — e.g. docs/hero.png of the Projection page + Screener.
     A hero visual is the single highest-impact addition to this README. -->

---

## What this demonstrates

| Area | In this repo |
|---|---|
| **Quant methodology** | Volume Profile (POC/VAH/VAL/HVN/LVN), multi-factor zone scoring, break-and-retest with R:R gating, Kaufman efficiency-ratio regime filter |
| **Statistical rigor** | Walk-forward out-of-sample backtest, forward paper-trading journal, Sharpe/Sortino/Calmar, t-stats with **Bonferroni** multiple-testing correction, "underpowered" guards |
| **Full-stack** | Python data engine **+** Next.js 16 / TypeScript dashboard **+** Upstash Redis **+** Discord bot **+** Vercel serverless & cron |
| **Production engineering** | Auth gating with explicit fail-open/closed reasoning, request de-dupe, monthly caching, Ed25519 webhook verification, secret hygiene |
| **Intellectual honesty** | A standing, machine-readable `EDGE_STATUS` that tells the truth about the strategy on every single alert |

---

## The methodology — why these zones are "strong"

The strongest S/R is where the most business got done. Every zone is scored
**0–100** by fusing five factors:

| Factor | Signal | Weight |
|---|---|---|
| **Volume-at-price** | Volume Profile — traded volume inside the price bin | 30% |
| **Touch count** | how many swing pivots respected the level | 22% |
| **Rejection** | avg ATR-normalized wick rejection at the band | 20% |
| **Confluence** | overlaps POC / VAH / VAL / HVN | 15% |
| **Recency** | time-decayed activity | 13% |

Core building blocks (`volume_profile.py`):
- **POC** (Point of Control) — single most-traded price → strongest magnet.
- **Value Area (VAH/VAL)** — 70% of volume; edges act as S/R.
- **HVN / LVN** — High/Low Volume Nodes (acceptance vs fast-move gaps).

**The play:** break-and-retest of a strong zone (`signals.py`). Price breaks a
strong zone on ≥1.5× volume + decisive ATR close-through → the zone flips →
price retests it → the engine emits an entry with **stop / target / R:R** (only
if R:R ≥ 1.5). Alert types: 👀 `watch` · 💥 `break` · 🎯 `retest`.

## The honest result — and why it's the point

The textbook cites break-and-retest as a ~60–70% structure. **My own
walk-forward backtest does not confirm that.** From `config.ts`:

> **Tier 0 — backtest OOS is NEGATIVE (−0.27R/trade, t −5.95, 763 trades).
> No token shows an edge. Discretionary use only — not a mechanical signal.**

That verdict is a first-class object in the codebase: it's injected into every
alert and headlines the dashboard, so the tool can never quietly imply an edge
it hasn't earned. An earlier version once hard-coded "~60–70% winrate" — that
number was never measured, contradicted the backtest, and was removed. Getting
_that_ right is the engineering lesson here.

---

## The three surfaces (Next.js dashboard)

A visual dashboard lives in [`web/`](web/) — the same methodology ported to
TypeScript, on Next.js 16.

- **Screener** (`/`) — live price chart with strength-colored zone lines, a
  volume-profile histogram (POC/Value Area highlighted), a ranked zone table,
  and an all-symbols alerts feed. Auto-refreshes every 30s.
- **Journal** (`/journal`) — a forward paper-trade record of every retest
  signal, with a standardized performance review: win rate, expectancy in R,
  Sharpe/Sortino/Calmar, and a t-stat with **Bonferroni** correction. It calls a
  slice an edge only when it clears the multiple-testing-adjusted bar — otherwise
  it says "underpowered" or "indistinguishable from luck."
- **Projection** (`/projection`) — BTC monthly-return history stitched back to
  **2013** (committed Bitstamp seed + live Binance, cached monthly) → a forward
  **Monte Carlo scenario cone** with bull/base/bear lines at 12/24 months. An
  optional **halving-cycle mode** draws each forward month from the matching
  post-halving phase, so the path bends through the corrective and pre-halving
  years. Includes a monthly-returns **heatmap** (extended with hover-able
  projected months) and a **live current-month** figure. Framed as scenario
  analysis, never a forecast.

## Architecture

```
                    free Binance / Bitstamp REST (no API key)
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        ▼                                                       ▼
  Python engine (root)                              Next.js 16 app  (web/, on Vercel)
  volume profile · zones ·                          ├─ dashboard: screener · journal · projection
  break-and-retest · CLI /                          ├─ /api/*  serverless analysis + projection
  Telegram/Discord alerts                           ├─ Upstash Redis  (de-dupe · journal · cache)
                                                     └─ cron → Discord (alerts + daily summary)
```

The Python engine (headless CLI/Telegram alerter) and the web app (visual
screener + 24/7 cloud alerter) share the methodology but run independently.

## Run it

**Python engine**
```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python engine.py --scan   # one-shot zone map for all symbols
./.venv/bin/python engine.py          # realtime loop (alerts every 30s)
```

**Web dashboard**
```bash
cd web
npm install
npm run dev      # http://localhost:3000
```

Optional env (all via `.env` / Vercel — never committed): `DISCORD_WEBHOOK_URL`,
`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`, Upstash `KV_REST_API_*`, `CRON_SECRET`,
`SITE_USER`/`SITE_PASSWORD`. See [`docs/configuration.md`](docs/configuration.md).

## Documentation

Full reference in [`docs/`](docs/) — architecture, methodology, the Python
engine, the web app, deployment/ops, backtest validation, and the go/no-go edge
criteria. Start at [docs/README.md](docs/README.md).

## Symbols & data

BTC, ETH, SOL, ONDO, TAO · free public Binance REST (no API key, mirror
failover) · Bitstamp for the pre-2017 monthly seed. Delayed-free, not
exchange-official — a screener, not execution truth.

---

> **Not financial advice.** This is a research and engineering project. The
> strategy's measured out-of-sample edge is negative; nothing here is a
> recommendation to trade. Position sizing and final decisions are yours.
