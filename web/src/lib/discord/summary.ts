/**
 * ② DAILY SUMMARY surface — 07:00 WIB briefing, to its OWN channel.
 *
 * Descriptive only: no signal, no recommendation, no claim about what happens
 * next. If you want it to say what to *do*, that's a new hypothesis and it goes
 * through docs/edge-criteria.md first.
 *
 * Content is built in lib/summary.ts; this module only ships it.
 *
 * No-op if DISCORD_SUMMARY_WEBHOOK_URL is unset — and it does NOT fall back to
 * the alert webhook, so a misconfig can't spam the trading channel with reports.
 *
 * See docs/discord-surfaces.md.
 */
import { postEmbeds } from "./transport";

export async function sendSummary(embed: object): Promise<void> {
  await postEmbeds([embed], "summary");
}
