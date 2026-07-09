# Configuration Reference

Single source of truth for every tunable knob and env var. Two config files
(one per app) hold the same defaults.

## Tunables — Python `config.py` / web `src/lib/config.ts`

| Knob (py / ts) | Default | Meaning |
|---|---|---|
| `SYMBOLS` | BTC, ETH, SOL, ONDO, TAO (USDT) | universe to scan |
| `STRUCT_TF` / `structTf` | `1h` | timeframe for volume profile & zones |
| `STRUCT_LOOKBACK` / `structLookback` | 500 | structural candles |
| `TRIGGER_TF` / `triggerTf` | `5m` | timeframe for break/retest triggers |
| `TRIGGER_LOOKBACK` / `triggerLookback` | 120 | trigger candles |
| `PROFILE_BINS` / `profileBins` | 100 | volume-profile resolution |
| `VALUE_AREA_PCT` / `valueAreaPct` | 0.70 | value area coverage |
| `HVN_PROMINENCE` / `hvnProminence` | 0.6 | min prominence for an HVN |
| `PIVOT_LOOKBACK` / `pivotLookback` | 3 | fractal strength (bars each side) |
| `CLUSTER_ATR_MULT` / `clusterAtrMult` | 0.6 | pivot merge distance (× ATR) |
| `ZONE_WIDTH_ATR` / `zoneWidthAtr` | 0.5 | zone half-width (× ATR) |
| `MIN_STRENGTH_ALERT` / `minStrengthAlert` | 55 | min zone strength for break/retest signals |
| `watchMinStrength` (ts only) | 70 | min zone strength for **watch** heads-ups (higher = quieter) |
| `WEIGHTS` / `weights` | see below | composite score weights (sum = 1.0) |
| `BREAK_VOL_MULT` / `breakVolMult` | 1.5 | breakout volume vs avg |
| `BREAK_ATR_MULT` / `breakAtrMult` | 0.25 | close-through distance (× ATR) |
| `RETEST_TOL_ATR` / `retestTolAtr` | 0.4 | retest proximity (× ATR) |
| `PROXIMITY_ATR` / `proximityAtr` | 0.8 | "watch" proximity (× ATR) |
| `minRetestRr` (ts only) | 1.5 | hard gate — don't emit retests below this R:R |
| `accountEquity` (ts only) | 1000 | reference account for journal-only position sizing |
| `riskPerTrade` (ts only) | 0.01 | fraction risked/trade for the sizing calc (journal only) |
| `regimeLookback` (ts only) | 20 | bars for the efficiency-ratio regime measure |
| `regimeMinEr` (ts only) | 0.3 | efficiency ratio ≥ this = trending, else range |
| `POLL_SECONDS` (py only) | 30 | loop cadence |
| `ROUND_STEP` (ts only) | `{ BTCUSDT: 1000 }` | round-level step per symbol |
| `ROUND_HYSTERESIS` (ts only) | 0.03 | fraction of step price must clear to confirm a cross (anti-flap) |
| `BINANCE_BASE` / `BINANCE_HOSTS` | Binance REST | data host(s) + mirrors |

**Weights:** volume 0.30, touches 0.22, rejection 0.20, confluence 0.15,
recency 0.13.

## Environment variables

### Python engine (root `.env`, loaded by `config._load_dotenv`)
| Var | Required? | Purpose |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | optional | Discord alerts |
| `TELEGRAM_TOKEN` | optional | Telegram bot token |
| `TELEGRAM_CHAT_ID` | optional | Telegram chat id |

Explicit shell `export`s override `.env` values.

### Web app (Vercel env vars — production)
| Var | Required? | Purpose |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | for alerts | Discord channel webhook |
| `CRON_SECRET` | for security | bearer token for `/api/cron/alert` |
| `SITE_USER` | for gate | dashboard Basic Auth username |
| `SITE_PASSWORD` | for gate | dashboard Basic Auth password |
| `KV_REST_API_URL` | for de-dupe/levels | Upstash (auto by integration) |
| `KV_REST_API_TOKEN` | for de-dupe/levels | Upstash (auto by integration) |

Fallbacks: `redisClient.ts` also accepts `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`. If Redis vars are absent, de-dupe passes through and
round-level alerts are disabled (fail-safe, no crash). If `SITE_*` are absent,
the auth gate opens (fail-open). If `DISCORD_WEBHOOK_URL` is absent, alerts
silently no-op. If `CRON_SECRET` is absent, the endpoint is unsecured.

> **Where secret values live:** only in Vercel env vars (web) and your local
> root `.env` (Python). Never in git. Rotate via the Vercel dashboard +
> redeploy, or by editing the local `.env`.

## Redis keys (web)

| Key | TTL | Purpose |
|---|---|---|
| `alert:<symbol>:<kind>:<zonePrice>` | 15 min | signal de-dupe |
| `rl:last:<symbol>` | none | last confirmed round-level bucket (hysteresis) |
| `oi:hist:<symbol>` | capped 3000 | accumulated OI samples for the liq map (forward-only) |
