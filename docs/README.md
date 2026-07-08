# Project Docs — Quant S/R Screener & Alerts

Living reference for this project. **Keep it in sync**: when you add, change,
or remove a feature, update the relevant doc here in the same change.

## What this project is

A crypto support/resistance screener with alerting, in two independent apps:

| App | Location | Role |
|---|---|---|
| **Python engine** | repo root | Headless realtime alerter (console + Telegram + Discord). Runs a `while True` loop on your machine. |
| **Web dashboard** | [`web/`](../web/) | Next.js 16 visual dashboard **and** the serverless cloud alerter (Vercel + cron pinger). Same methodology ported to TypeScript. |

They share **no code** — they independently implement the same methodology.
The web app is what runs 24/7 in the cloud; the Python engine is the local CLI.

## Doc index

| Doc | Read it when… |
|---|---|
| [architecture.md](architecture.md) | You want the big picture + data flow + the cloud alert pipeline. |
| [methodology.md](methodology.md) | You're touching zone scoring, volume profile, signals, or round levels — the "why". |
| [python-engine.md](python-engine.md) | You're changing the Python CLI / local alerter. |
| [web-app.md](web-app.md) | You're changing the Next.js dashboard, lib modules, API routes, or auth gate. |
| [deployment.md](deployment.md) | You're deploying, changing env vars, cron schedule, Upstash, or the password gate. |
| [configuration.md](configuration.md) | You need the single source of truth for every tunable knob + env var. |

## Fast facts

- **GitHub:** `hanreywt/Screener_Alert` (single repo, both apps)
- **Live dashboard:** `https://web-lovat-beta-nsjxoj6e9r.vercel.app` (password-gated)
- **Vercel project:** `web` under `hanreywts-projects`
- **Symbols:** BTCUSDT, ETHUSDT, SOLUSDT, ONDOUSDT
- **Data source:** public Binance REST (no API key), with mirror failover
- **Alert channels:** Discord webhook (primary), Telegram (optional), console

## Conventions for changing things

- **Two-app parity:** if you change methodology in one app, decide whether the
  other needs the same change. They can legitimately drift, but note it.
- **Secrets live in env vars only** — never commit real values. See
  [configuration.md](configuration.md) for the full list.
- **Verify before shipping:** typecheck (`npx tsc --noEmit` in `web/`), and for
  the cron endpoint, hit it with the `CRON_SECRET` bearer header.
