# Web App (Next.js 16 dashboard + serverless alerter)

Lives in [`web/`](../web/). Two jobs: the visual dashboard **and** the 24/7
cloud alerter. Deployed to Vercel.

> ⚠️ **This is Next.js 16 — not the version in your training data.** Key rename:
> Middleware → **Proxy** (`proxy.ts`, exports a `proxy` function). Before writing
> Next-specific code, check `web/node_modules/next/dist/docs/`.

## Structure

Modules are grouped by **which product they serve** — see
[discord-surfaces.md](discord-surfaces.md). Shared plumbing sits at the bottom.

```
web/src/
  app/
    layout.tsx, page.tsx, globals.css     # dashboard UI (the scan)
    journal/page.tsx                      # journal + performance review UI
    api/analysis/route.ts                 # GET ?symbol= → full analysis JSON
    api/stats/route.ts                    # live track record + perf review (journal)
    api/cron/alert/route.ts               # ① ALERTS  — realtime, every 2–5 min
    api/cron/summary/route.ts             # ② SUMMARY — daily 00:00 UTC (07:00 WIB)
    api/discord/interactions/route.ts     # ③ /scan slash command
  components/
    ChartPanel.tsx        # price chart + zone lines + PDH/PDL/PWH/PWL lines
    VolumeProfilePanel.tsx# volume histogram (POC/VA highlighted)
    ZoneTable.tsx         # ranked zone table
    KeyLevels.tsx         # prev day/week high-low panel (display only)
    AlertsFeed.tsx        # all-symbols alerts feed
  lib/
    discord/              # ── all Discord I/O, one file per surface ──
      transport.ts        #   postEmbeds(embeds, target) — ONLY place that
                          #   touches a webhook URL
      alerts.ts           #   ① signal / level / trade-entry / trade-exit embeds
      summary.ts          #   ② sendSummary → the summary channel
      scan.ts             #   ③ /scan embed builder
    ── ① ALERTS domain ──
    signals.ts            # watch / break / retest (stateless!) + regime gate
    zones.ts              # zone detection + scoring
    dedupe.ts             # Upstash de-dupe of repeat signals
    journal.ts            # forward paper-trade record + forwardNotes() (Redis)
    roundLevels.ts        # round-number crossing detection (Redis-backed)
    liquidations.ts       # estimated liq clusters (forward-accumulated, Redis)
    derivatives.ts        # OI + funding + mark from Hyperliquid (one call)
    ── ② SUMMARY domain ──
    summary.ts            # builds the daily briefing (content, not transport)
    ── SHARED ──
    binance.ts            # klines/price/ATR, mirror failover, paged fetch
    volumeProfile.ts      # POC / VA / HVN / LVN  (built from 15m candles)
    regime.ts             # Kaufman efficiency-ratio trend/range classifier
    refLevels.ts          # prev day/week high-low — DISPLAY ONLY, never a signal
    metrics.ts            # standardised perf review (backtest AND journal)
    analysis.ts           # orchestrates one symbol's full analysis
    redisClient.ts        # shared Upstash client (KV_REST_API_* or UPSTASH_*)
    config.ts             # SYMBOLS, CONFIG, EDGE_STATUS, ROUND_STEP, BINANCE_HOSTS
    types.ts, ui.ts       # shared types + UI helpers
  proxy.ts                # Basic Auth gate (all routes except /api/cron|discord/*)
  scripts/
    backtest.ts           # walk-forward backtest + per-symbol edge table
    research.ts           # parameter research
    profile-diff.ts       # 1h-vs-15m volume-profile A/B on live data
  vercel.json             # Vercel cron declaration (daily fallback only)
```

**The rule that keeps this clean:** `lib/discord/transport.ts` is the *only*
module that reads a webhook URL. Everything else builds embeds and hands them
over. Adding a channel = adding a `target`, not a new `fetch`.

## Run locally

```bash
cd web
npm install
npm run dev            # http://localhost:3000  (NOTE: npm run dev, not "npm dev")
```

## API routes

### `GET /api/analysis?symbol=BTCUSDT`
Public-shaped (but behind the Basic Auth gate). Returns the full analysis JSON:
price, ATR, volume profile, ranked zones, signals. The dashboard polls this
client-side (auto-refresh ~30s).

### `GET /api/cron/alert` — the alerter
- **Auth:** requires `Authorization: Bearer <CRON_SECRET>` (401 otherwise).
  Exempt from the Basic Auth proxy gate.
- **Does:** analyze all `SYMBOLS` in parallel → collect zone signals +
  round-level crossings → `filterUnseen` de-dupe → POST to Discord.
- **Returns:** `{ ok, scanned, found, sent, crossed, errors? }`.
- **Stateless signal logic** (`evaluate` in `signals.ts`) — detects
  watch/break/retest purely from the current candle window, which is what makes
  it safe to run as an isolated serverless invocation.

### `POST /api/discord/interactions` — slash commands
Discord's HTTP-interactions endpoint (no always-on bot needed). Verifies the
Ed25519 signature (`DISCORD_PUBLIC_KEY`), answers PINGs, and handles `/scan
<symbol>` by deferring then editing in the result (`buildScanEmbed`). Register
the command with `scripts/register-commands.mjs`. Runtime env:
`DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`. Exempt from the auth gate.

## Auth gate (`proxy.ts`)

HTTP Basic Auth on every route **except** `/api/cron/*` and `/api/discord/*`. Reads `SITE_USER` /
`SITE_PASSWORD`. **Fail-open**: if either env var is missing, the gate is
disabled (so a misconfig can't lock everyone out). Once a browser authenticates,
it reuses credentials for same-origin fetches (e.g. `/api/analysis`), so the
dashboard works behind the gate.

## De-dupe & round levels (Redis)

Both use the shared `redisClient.ts`. Redis is **optional** — if unconfigured,
`dedupe` passes everything through and `roundLevels` no-ops. Keys:
- `alert:<symbol>:<kind>:<zonePrice>` — signal de-dupe (15-min TTL)
- `rl:last:<symbol>` — last round-level bucket (persistent)
- `rl:seen:<symbol>:<level>:<dir>` — round-level anti-flap (15-min TTL)

### `GET /api/cron/summary` — the daily briefing
- **Auth:** `Authorization: Bearer <CRON_SECRET>`. Exempt from the Basic Auth gate.
- **Does:** `buildSummary()` → yesterday's close/%/range/volume/rel-volume,
  regime, PDH/PDL/PWH/PWL level events → posts to the **summary** channel.
- **Query flags:** `?dry=1` build without posting · `?force=1` bypass the
  once-per-day guard.
- **Returns:** `{ ok, sent, day }` · `{ ok, skipped: "already sent today" }`.
- Separate channel, separate cron job, **descriptive only** — see
  [discord-surfaces.md](discord-surfaces.md).

## Adding a symbol or feature

- **New symbol:** add to `SYMBOLS` in `config.ts` (and Python `config.py` for
  parity). Optionally add a `ROUND_STEP` entry.
- **New round-level step:** edit `ROUND_STEP` in `config.ts`.
- **New Discord channel/surface:** follow the checklist at the bottom of
  [discord-surfaces.md](discord-surfaces.md). Short version: new webhook env var,
  new `target` in `lib/discord/transport.ts`, new `lib/discord/<thing>.ts` sender.
  **Never reuse another surface's webhook.**
- **Changing what an alert claims:** it may only state what it can measure.
  `config.EDGE_STATUS` is the single source of truth for the standing verdict;
  the per-symbol record comes from `journal.forwardNotes()`. Do not hard-code a
  win rate — one used to live in `signals.ts` and it was wrong.
- Always `npx tsc --noEmit` before deploying.
