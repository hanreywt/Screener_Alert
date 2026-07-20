# Support/Resistance Engine

Realtime, volume-weighted support/resistance detection + break-and-retest
alerts for **BTC, ETH, SOL, ONDO, TAO** — using free Binance market data (no API
key required).

## The methodology (why these zones are "strong")

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

## The play (highest winrate)

**Break-and-retest of a strong zone** (`signals.py`). In trending crypto this
is the ~60–70% winrate structure:

1. Price **breaks** a strong zone on ≥1.5× average volume + decisive ATR
   close-through → the zone gets a **Break Rating (0–100)**.
2. The zone **flips** (broken resistance → new support).
3. Price **retests** it → engine emits an entry with **stop / target / R:R**.
   Rule of thumb: only take if **R:R ≥ 1.5**.

Alert types: 👀 `watch` (near a strong zone) · 💥 `break` · 🎯 `retest`.

## Usage

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt

./.venv/bin/python engine.py --scan   # one-shot zone map for all symbols
./.venv/bin/python engine.py          # realtime loop (alerts every 30s)
```

### Telegram alerts (optional)
```bash
export TELEGRAM_TOKEN="123456:abc..."
export TELEGRAM_CHAT_ID="987654321"
```
Alerts print to console always; Telegram fires too when these are set.

### Discord alerts (optional)
Create a channel webhook in Discord (Server Settings → Integrations →
Webhooks → New Webhook → Copy URL), then:
```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/<id>/<token>"
```
Each alert is posted as a color-coded embed (blue watch · red break ·
green retest) with zone, strength, and — for retests — entry/stop/target/R:R.
Telegram and Discord can both be enabled at once.

## Tuning

All knobs live in `config.py` — symbols, timeframes (`STRUCT_TF` builds
zones, `TRIGGER_TF` fires triggers), scoring weights, break thresholds,
`MIN_STRENGTH_ALERT`, poll cadence.

## Files

| File | Role |
|---|---|
| `config.py` | all parameters |
| `data.py` | Binance realtime data + ATR (mirror failover) |
| `volume_profile.py` | POC / Value Area / HVN / LVN |
| `zones.py` | pivot clustering + strength scoring |
| `signals.py` | break rating + break-and-retest play |
| `alerts.py` | console + Telegram + Discord dispatch |
| `engine.py` | realtime loop / `--scan` |

## Web dashboard (Next.js)

A visual dashboard lives in [`web/`](web/) — same methodology ported to
TypeScript, served by Next.js 16. Three pages:

- **Screener** (`/`) — live price chart with strength-colored zone lines, a
  volume-profile histogram (POC/Value Area highlighted), a ranked zone table,
  and an all-symbols alerts feed. Auto-refreshes every 30s.
- **Journal** (`/journal`) — forward paper-trade record of every retest signal
  with a standardized performance review: win rate, expectancy in R, Sharpe /
  Sortino / Calmar, and a t-stat with Bonferroni multiple-testing correction.
  Deliberately honest about whether an edge exists — see `EDGE_STATUS`.
- **Projection** (`/projection`) — BTC monthly-return history stitched back to
  **2013** (committed Bitstamp seed + live Binance, cached monthly) → a forward
  **Monte Carlo scenario cone** with bull/base/bear lines at 12/24 months.
  Optional **halving-cycle mode** draws each forward month from the matching
  post-halving phase, so the path bends through the corrective and pre-halving
  years. Includes a Coinglass-style **monthly-returns heatmap** (extended with
  hover-able projected months) and a **live current-month** figure. Framed as
  scenario analysis, never a forecast.

```bash
cd web
npm install
npm run dev      # http://localhost:3000
```

Server routes: `GET /api/analysis?symbol=BTCUSDT` returns the full analysis JSON
(price, ATR, volume profile, ranked zones, signals); `GET /api/projection`
returns the BTC monthly history + forward projection. Deploys to Vercel as-is.

The Python engine (root) and the web app are independent — Python is the
headless CLI/Telegram alerter, the web app is the visual screener.

## Documentation

Full project reference lives in [`docs/`](docs/) — architecture, methodology,
the Python engine, the web app, deployment/ops, and a configuration reference.
**Keep it in sync when you change things.** Start at [docs/README.md](docs/README.md).

## Notes
- Public Binance data is delayed-free but not exchange-official; treat as a
  screener, not execution truth. Position sizing and final entries are yours.
- Not financial advice.
