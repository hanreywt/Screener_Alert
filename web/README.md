This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Discord alerts on Vercel (serverless)

`GET /api/cron/alert` scans every symbol once, de-dupes against recent
alerts (Upstash Redis), and posts new signals to a Discord channel webhook.
It's the serverless equivalent of the Python `engine.py` loop — a scheduler
hits it on an interval instead of a `while True` loop.

### Environment variables (Vercel → Project → Settings → Environment Variables)

| Var | Purpose |
|---|---|
| `DISCORD_WEBHOOK_URL` | Discord channel webhook (Server Settings → Integrations → Webhooks) |
| `CRON_SECRET` | random string; callers must send `Authorization: Bearer <CRON_SECRET>` |
| `KV_REST_API_URL` | auto-added by the Upstash marketplace integration (or `UPSTASH_REDIS_REST_URL` for manual setups) |
| `KV_REST_API_TOKEN` | auto-added by the Upstash marketplace integration (or `UPSTASH_REDIS_REST_TOKEN`) |

Add the Upstash Redis store in one click: Vercel dashboard → Storage (or
Marketplace) → Upstash → connect to this project. The two `UPSTASH_*` vars
are injected automatically.

### Scheduling

- **Pro plan:** `vercel.json` already declares a cron. Change its schedule
  to `* * * * *` (every minute) for near-real-time alerts.
- **Hobby plan:** Vercel cron only fires once/day, so drive it with a free
  external pinger instead. Point [cron-job.org](https://cron-job.org) (or
  GitHub Actions / UptimeRobot) at
  `https://<your-app>.vercel.app/api/cron/alert` every 1–5 min, with header
  `Authorization: Bearer <CRON_SECRET>`. Upstash dedupe keeps frequent pings
  from spamming the channel.

The Discord embed formatting lives in `src/lib/discord.ts`; dedupe in
`src/lib/dedupe.ts`; the endpoint in `src/app/api/cron/alert/route.ts`.

### Round-number level alerts

`src/lib/roundLevels.ts` also fires an alert whenever a symbol **crosses a
psychological round level** (up or down), using Redis to remember the last
level across serverless runs. Configure step sizes in `src/lib/config.ts`:

```ts
export const ROUND_STEP: Partial<Record<Symbol, number>> = {
  BTCUSDT: 1000, // alert every $1,000 (62k, 63k, ...)
  // ETHUSDT: 100, SOLUSDT: 5, ONDOUSDT: 0.05,  // uncomment to enable
};
```

Same level+direction is de-duped for 15 min to suppress chop around a line.
