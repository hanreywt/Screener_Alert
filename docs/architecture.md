# Architecture

## Two independent apps, one methodology

```
repo root (Python)                     web/ (Next.js 16 + TypeScript)
──────────────────                     ──────────────────────────────
engine.py  (while-True loop)           dashboard (browser UI)
  → data.py (Binance)                  + /api/cron/alert (serverless alerter)
  → volume_profile / zones / signals     → src/lib/* (same methodology in TS)
  → alerts.py (console/Telegram/Discord)  → Discord webhook

Runs on YOUR machine, on demand.        Runs 24/7 in the cloud (Vercel).
```

They do **not** share code. Each re-implements: Binance fetch → ATR →
volume profile → zone detection/scoring → break/retest signals → dispatch.

## The cloud alert pipeline (the 24/7 path)

This is what actually alerts you when you're away from the laptop:

```
cron-job.org (external scheduler, every 2–5 min)
   │  GET  /api/cron/alert
   │  Header: Authorization: Bearer <CRON_SECRET>
   ▼
Vercel Function  (web/src/app/api/cron/alert/route.ts)
   │  1. auth check (CRON_SECRET)
   │  2. analyze() each symbol   → zone signals (watch/break/retest)
   │  3. checkLevelCross()       → round-number crossings (BTC $1k)
   │  4. filterUnseen()          → Upstash Redis de-dupe (15-min TTL)
   ▼
Discord channel webhook  → your phone (Discord push notification)
```

## The daily summary pipeline (the 07:00 briefing)

A **separate** product on a **separate** channel — not part of the alert path:

```
cron-job.org (second job, 00:00 UTC = 07:00 WIB)
   │  GET  /api/cron/summary
   │  Header: Authorization: Bearer <CRON_SECRET>
   ▼
Vercel Function  (web/src/app/api/cron/summary/route.ts)
   │  1. auth check (CRON_SECRET)
   │  2. buildSummary()  → yesterday's close/%/range/volume/rel-volume,
   │                       regime, PDH/PDL/PWH/PWL level events
   │  3. once-per-day guard (Redis `summary:sent:<day>`)
   ▼
DISCORD_SUMMARY_WEBHOOK_URL  → the daily-summary channel (NOT the alert channel)
```

Descriptive only — no signal, no recommendation. The two pipelines share the
Binance fetch layer and `postEmbeds()` transport, and nothing else. Full rules
for what each surface may say: [discord-surfaces.md](discord-surfaces.md).

### Why an external cron (not Vercel Cron)?

Vercel's built-in Cron only fires **once per day on the free Hobby plan** —
useless for price alerts. So we deploy the endpoint to Vercel (free) and drive
it with a free external pinger (cron-job.org) every few minutes. Same result as
Vercel Pro cron, $0. See [deployment.md](deployment.md).

### Why Redis (Upstash)?

Serverless functions have **no memory between runs**. Redis provides the state
the Python loop keeps in-process:
- **De-dupe** (`filterUnseen`) — don't re-send the same signal every run.
- **Round-level tracking** (`checkLevelCross`) — remember BTC's last $1k bucket
  to detect crossings.

## Security layers

| Surface | Protection |
|---|---|
| `/api/cron/alert` | `CRON_SECRET` bearer token (401 without it) |
| Dashboard + all other routes | HTTP Basic Auth via `web/src/proxy.ts` (`SITE_USER`/`SITE_PASSWORD`) |
| Secrets (webhook, tokens) | Server-side env vars only — never sent to browser |

The cron endpoint is **exempt** from the Basic Auth gate (the scheduler can't
log in), but is still protected by its own `CRON_SECRET`.

## Data flow within one analysis pass

1. **Fetch** structural candles (1h ×500) + trigger candles (5m ×120) + price.
2. **ATR** from structural candles (volatility unit for all thresholds).
3. **Volume profile** → POC / Value Area (VAH/VAL) / HVN / LVN.
4. **Zones** → cluster swing pivots, score 0–100 (volume/touches/rejection/
   confluence/recency), tag with POC/VAH/HVN etc.
5. **Signals** → for strong zones near price: watch / break / break-and-retest.
6. **Round levels** (web only) → bucket crossings with direction.
7. **Dispatch** → console / Telegram / Discord.

See [methodology.md](methodology.md) for the math and rationale.
