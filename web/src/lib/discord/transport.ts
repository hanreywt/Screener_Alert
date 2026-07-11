/**
 * The ONLY module that touches a Discord webhook URL.
 *
 * Every surface (alerts, daily summary, /scan) builds embeds and hands them to
 * postEmbeds with a target. Adding a channel means adding a target here — never
 * a new fetch() somewhere else. That's what keeps the surfaces from bleeding
 * into each other's channels.
 *
 * See docs/discord-surfaces.md.
 */

/** Which Discord channel an embed is destined for. One env var each. */
export type Target = "alerts" | "summary";

const WEBHOOK_ENV: Record<Target, string> = {
  alerts: "DISCORD_WEBHOOK_URL",
  summary: "DISCORD_SUMMARY_WEBHOOK_URL",
};

/**
 * POST a batch of embeds to a channel (chunked at Discord's 10-per-message cap).
 *
 * If the target's webhook is unset we send NOTHING — deliberately no fallback to
 * another channel. A missing summary webhook should be silent, not post daily
 * reports into the trading-alert channel.
 *
 * Never throws: alerting must not be able to crash a cron run.
 */
export async function postEmbeds(
  embeds: object[],
  target: Target = "alerts",
): Promise<void> {
  const url = process.env[WEBHOOK_ENV[target]];
  if (!url || embeds.length === 0) return;
  for (let i = 0; i < embeds.length; i += 10) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: embeds.slice(i, i + 10) }),
      });
    } catch {
      // swallow — a webhook failure must never take down the cron run
    }
  }
}
