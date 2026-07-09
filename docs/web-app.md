# Web App (Next.js 16 dashboard + serverless alerter)

Lives in [`web/`](../web/). Two jobs: the visual dashboard **and** the 24/7
cloud alerter. Deployed to Vercel.

> ⚠️ **This is Next.js 16 — not the version in your training data.** Key rename:
> Middleware → **Proxy** (`proxy.ts`, exports a `proxy` function). Before writing
> Next-specific code, check `web/node_modules/next/dist/docs/`.

## Structure

```
web/src/
  app/
    layout.tsx, page.tsx, globals.css     # dashboard UI
    api/analysis/route.ts                 # GET ?symbol= → full analysis JSON
    api/cron/alert/route.ts               # the serverless alerter (cron target)
    api/discord/interactions/route.ts     # Discord slash-command endpoint (/scan)
    api/stats/route.ts                    # live signal track record (journal)
  components/
    ChartPanel.tsx        # price chart + strength-colored zone lines
    VolumeProfilePanel.tsx# volume histogram (POC/VA highlighted)
    ZoneTable.tsx         # ranked zone table
    AlertsFeed.tsx        # all-symbols alerts feed
  lib/
    binance.ts            # klines/price/ATR with mirror failover
    volumeProfile.ts      # POC / VA / HVN / LVN
    zones.ts              # zone detection + scoring
    signals.ts            # watch / break / retest (stateless!) + regime gate
    regime.ts             # Kaufman efficiency-ratio trend/range classifier
    analysis.ts           # orchestrates one symbol's full analysis
    journal.ts            # forward track record of retest trades (Redis)
    derivatives.ts        # OI + funding + mark from Hyperliquid (one call)
    liquidations.ts       # estimated liq clusters (forward-accumulated, Redis)
    roundLevels.ts        # round-number crossing detection (Redis-backed)
    dedupe.ts             # Upstash de-dupe of repeat signals
    discord.ts            # embed formatting + webhook POST
    redisClient.ts        # shared Upstash client (KV_REST_API_* or UPSTASH_*)
    config.ts             # SYMBOLS, CONFIG, ROUND_STEP, BINANCE_HOSTS
    types.ts, ui.ts       # shared types + UI helpers
  proxy.ts                # Basic Auth gate (all routes except /api/cron/*)
  vercel.json             # Vercel cron declaration (daily fallback)
```

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

## Adding a symbol or feature

- **New symbol:** add to `SYMBOLS` in `config.ts` (and Python `config.py` for
  parity). Optionally add a `ROUND_STEP` entry.
- **New round-level step:** edit `ROUND_STEP` in `config.ts`.
- **New alert channel:** add a sender in `discord.ts` style, call it from the
  cron route.
- Always `npx tsc --noEmit` before deploying.
