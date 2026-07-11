# Discord Surfaces — three products, one server

The bot talks to Discord in **three separate ways**. They look similar (they all
post embeds) but they have different purposes, different channels, different
schedules, and — critically — **different rules about what they're allowed to
say**. Keeping them straight is what stops the alert channel filling up with
reports, and stops a descriptive report drifting into sounding like a trade call.

> **The one rule:** a surface may only claim what it can measure. See
> [edge-criteria.md](edge-criteria.md) for the current tier (today: **Tier 0**,
> no proven edge). `config.EDGE_STATUS` is the single source of truth for the
> standing verdict — every actionable surface repeats it.

## The three surfaces

| | **① Alerts** | **② Daily Summary** | **③ `/scan` command** |
|---|---|---|---|
| **Purpose** | "Something is happening *now*" | "Here's what happened yesterday" | "Show me this coin on demand" |
| **Channel** | trading-alerts | daily-summary (separate) | wherever you type it |
| **Webhook env** | `DISCORD_WEBHOOK_URL` | `DISCORD_SUMMARY_WEBHOOK_URL` | *(none — HTTP interactions)* |
| **Trigger** | cron-job.org, every 2–5 min | cron-job.org, 00:00 UTC (07:00 WIB) | user types `/scan BTC` |
| **Endpoint** | `/api/cron/alert` | `/api/cron/summary` | `/api/discord/interactions` |
| **Content code** | `lib/signals.ts`, `lib/journal.ts` | `lib/summary.ts` | `lib/discord/scan.ts` |
| **Send code** | `lib/discord/alerts.ts` | `lib/discord/summary.ts` | `lib/discord/scan.ts` |
| **State (Redis)** | de-dupe, journal, round levels | once-per-day guard | none |
| **May recommend?** | No — it reports setups + their measured record | **No** — descriptive only | No |

All three share one piece of plumbing: `lib/discord/transport.ts` (`postEmbeds`),
which is the *only* place that touches a webhook URL.

---

## ① Alerts — realtime

**Fires when:** a zone signal (watch / break / retest), a round-level crossing,
or a paper-trade open/close happens.

**Embeds** (all in `lib/discord/alerts.ts`):

| Embed | Sent by | When |
|---|---|---|
| `signalEmbed` | `sendDiscord()` ← cron/alert | watch + break signals |
| `levelEmbed` | `sendLevelCrosses()` ← cron/alert | BTC crosses a $1k level |
| `sendTradeEntry` | `logSignals()` ← `lib/journal.ts` | a retest opens a paper trade (**BOT ENTRY**) |
| `sendTradeExit` | `resolveOpen()` ← `lib/journal.ts` | that trade hits target / stop / expiry |

**Retests are NOT sent via `signalEmbed`.** The cron route filters them out
(`fresh.filter(s => s.kind !== "retest")`) because the journal already announces
them as **BOT ENTRY** — otherwise every retest would post twice.

**Every actionable alert carries `recordNote`** — the *measured* forward record
for that symbol, built by `journal.forwardNotes()`, plus `EDGE_STATUS`. This
replaced a hard-coded "~60-70% historical winrate" that was never measured and
that the backtest disproves. **Do not add a claimed win rate back.**

**To tweak:** thresholds → `config.ts` (`minStrengthAlert`, `watchMinStrength`,
`minRetestRr`). Embed layout → `lib/discord/alerts.ts`. What fires at all →
`lib/signals.ts`.

---

## ② Daily Summary — 07:00 WIB briefing

**Fires once a day**, summarising the UTC day that just closed. Purely
descriptive: per coin close, % change, day range, volume, **volume vs its prior
20-day average** (says whether a move had real participation), regime, and level
events against PDH/PDL/PWH/PWL ("swept prior-day high then closed back below"
reads very differently from "broke above and held").

**It contains no signal and no recommendation, and it must stay that way.** If
you want it to tell you what to *do*, that's a new hypothesis → backtest it first
([edge-criteria.md](edge-criteria.md)).

**Two correctness rules, both learned the hard way:**

1. **Date comes from the candle, never the clock.** The cron fires at *exactly*
   00:00 UTC — the instant the day rolls — so `now - 1d` and "the last closed
   daily candle" can disagree by a day at the boundary. That would mislabel the
   report *and* break the once-per-day guard keyed on it.
2. **Always use the last *closed* candle** (index `-2`). Index `-1` is the
   still-forming period, whose high/low/volume keep moving. Same trap as
   `lib/refLevels.ts`.

**Guards:** posts once per reported day (Redis `summary:sent:<day>`), because
cron-job.org retries on timeout and would otherwise post 2–3 times. If
`DISCORD_SUMMARY_WEBHOOK_URL` is unset it sends **nothing** — it deliberately does
**not** fall back to the alert webhook, so a misconfig stays quiet instead of
spamming the trading channel.

**Testing:** `?dry=1` builds and returns the summary **without posting**.
`?force=1` posts even if today's already went out.

```bash
SECRET=<CRON_SECRET>; URL=https://web-lovat-beta-nsjxoj6e9r.vercel.app
curl -H "Authorization: Bearer $SECRET" "$URL/api/cron/summary?dry=1"    # build only
curl -H "Authorization: Bearer $SECRET" "$URL/api/cron/summary?force=1"  # post now
```

**ETF flow is a deliberate gap.** No free API; Farside (the canonical free
source) returns **403** to automated fetches; CoinGlass/Newhedge/Glassnode are
paid. And US flows for the session that just closed usually aren't published by
00:00 UTC, so a 7am report would often show the *previous* session's number. If
added, it **must** carry an explicit `as of <date>` stamp and a distinct
"no ETF session" state for weekends — never a bare `$0`, which would conflate
"markets were closed" with "flows were flat".

**To tweak:** content → `lib/summary.ts` (`VOL_BASELINE_DAYS`, the table columns,
the level-event wording). Schedule → the cron-job.org job.

---

## ③ `/scan` slash command — on demand

Discord HTTP-interactions endpoint; **no always-on bot process needed**. Verifies
Ed25519 signatures (`DISCORD_PUBLIC_KEY`), answers PINGs, and handles
`/scan <symbol>` by deferring, then editing in the result.

Register the command with `scripts/register-commands.mjs`. Runtime env:
`DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`.

**To tweak:** embed content → `lib/discord/scan.ts` (`buildScanEmbed`).

---

## Adding a fourth surface

1. Add a webhook env var (`DISCORD_<THING>_WEBHOOK_URL`) — **never** reuse an
   existing channel's webhook.
2. Add a `target` to `postEmbeds()` in `lib/discord/transport.ts`.
3. Give it its own `lib/discord/<thing>.ts` sender, its own content module, and —
   if scheduled — its own `/api/cron/<thing>` route with a `CRON_SECRET` check,
   a `?dry=1` mode, and an idempotence guard.
4. Decide **in writing** what it is allowed to claim, and add a row to the table
   at the top of this file.
5. Update [configuration.md](configuration.md) (env var) and
   [deployment.md](deployment.md) (cron job).
