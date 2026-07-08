# Deployment & Operations

How the cloud alerter is deployed and driven. All of this is the **web app**;
the Python engine is local-only.

## Stack

| Piece | What | Plan/cost |
|---|---|---|
| **Vercel** | hosts the Next.js app + `/api/cron/alert` function | Hobby (free) |
| **cron-job.org** | external scheduler that pings the endpoint | free |
| **Upstash Redis** | de-dupe + round-level state | free tier |
| **Discord webhook** | alert delivery | free |
| **GitHub** | `hanreywt/Screener_Alert` source | free |

- **Vercel project:** `web` under `hanreywts-projects`
- **Production URL:** `https://web-lovat-beta-nsjxoj6e9r.vercel.app`
- **Root Directory** in Vercel project settings must be **`web/`** (the Next.js
  app is a subfolder; the repo root is the Python engine).

## Deploying

From `web/` with the Vercel CLI (logged in as the project owner):

```bash
cd web
vercel deploy --yes --prod     # build + promote to production
```

Env-var changes only take effect on a **new** deployment — always redeploy after
editing env vars.

## Environment variables (Vercel → project → Settings → Env Vars)

See [configuration.md](configuration.md) for the authoritative list. Summary:

| Var | Purpose | Set by |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | Discord channel webhook | you (dashboard) |
| `CRON_SECRET` | bearer token guarding `/api/cron/alert` | generated |
| `SITE_USER` / `SITE_PASSWORD` | dashboard Basic Auth login | generated/you |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis | Upstash integration (auto) |

> **Never commit real values.** They live only in Vercel. To rotate: edit in the
> dashboard (or `vercel env rm` + re-add) and redeploy.

## The scheduler (cron-job.org)

Vercel's own cron fires only **once/day on Hobby**, so an external pinger drives
the real cadence.

- **URL:** `https://web-lovat-beta-nsjxoj6e9r.vercel.app/api/cron/alert`
- **Schedule:** every 2–5 min (`*/2 * * * *` etc.). Safe at 1 min too — Redis
  de-dupe prevents spam. Signals are computed on 5m candles, so <2 min gives
  diminishing returns (lower latency, not more signals).
- **Header (required):** `Authorization: Bearer <CRON_SECRET>` — added under
  cron-job.org's **Advanced → Headers** (NOT the "HTTP authentication" box).
- Turn on "Save responses in job history" to debug (look for `{"ok":true,...}`).
- A `401` in history = the header is wrong (usually missing `Bearer ` prefix).

## Provisioning Upstash (one-time)

Via Vercel dashboard: **Storage → Create Database → Upstash for Redis → free →
connect to `web`**. Auto-injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`.

CLI equivalent:
```bash
vercel integration add upstash/upstash-kv --environment production
```

## Password gate (privacy)

The dashboard is private via `web/src/proxy.ts` Basic Auth (`SITE_USER` /
`SITE_PASSWORD`). Note: Vercel's own "Vercel Authentication" does **not** protect
the production URL on Hobby (only preview URLs) — that's why we gate in-app.
Custom Vercel Password Protection is Pro-only.

## Verifying a deploy

```bash
SECRET=<CRON_SECRET>
URL=https://web-lovat-beta-nsjxoj6e9r.vercel.app
curl -s -o /dev/null -w "%{http_code}\n" "$URL/"                                  # 401 (gated) ✅
curl -s -o /dev/null -w "%{http_code}\n" -u "USER:PASS" "$URL/"                   # 200 ✅
curl -s -H "Authorization: Bearer $SECRET" "$URL/api/cron/alert"                  # {"ok":true,...} ✅
curl -s -o /dev/null -w "%{http_code}\n" "$URL/api/cron/alert"                    # 401 (no secret) ✅
```

`sent:0` on repeat calls is **correct** — Redis de-dupe suppressing repeats.
A quiet Discord channel ≠ broken; the cron-job.org history going green is proof.

## Common gotchas

- **No new Discord messages** → usually de-dupe (15-min window), not a failure.
- **Browser shows `{"error":"unauthorized"}`** → expected; browsers can't send
  the cron bearer header. Only cron-job.org (with the header) gets through.
- **Alerts stopped after enabling site protection** → the gate must exempt
  `/api/cron/*` (it does in `proxy.ts`); don't add Vercel-level protection
  without an automation bypass.
