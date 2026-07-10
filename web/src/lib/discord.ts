import type { Signal } from "./types";
import type { LevelCross } from "./roundLevels";

const ICON: Record<string, string> = {
  watch: "👀",
  break: "💥",
  retest: "🎯",
  bounce: "🔄",
};

// Embed accent colors per alert kind (decimal RGB), mirrors alerts.py.
const COLOR: Record<string, number> = {
  watch: 0x3498db, // blue
  break: 0xe74c3c, // red
  retest: 0x2ecc71, // green
  bounce: 0xf1c40f, // yellow
};

function bar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

/**
 * Descriptive conviction 0-100 — how *textbook-clean* the setup is (strength +
 * break rating + R:R). NOT a win probability; the backtest says these setups
 * are ~coin-flip. It's a readability aid, not an edge claim.
 */
function convictionScore(s: Signal): number {
  if (s.kind === "watch") return s.strength * 0.5; // heads-up only
  if (s.kind === "break") return 0.4 * s.strength + 0.6 * (s.breakRating ?? 0);
  if (s.kind === "retest") {
    const rrScore = Math.min(100, ((s.rr ?? 0) / 2) * 100); // R:R 2 → 100
    return 0.4 * s.strength + 0.3 * (s.breakRating ?? 0) + 0.3 * rrScore;
  }
  return s.strength;
}

/** One-glance conviction line: meter + key qualifiers. */
function convictionLine(s: Signal): string {
  const dots = Math.max(1, Math.min(5, Math.round(convictionScore(s) / 20)));
  const meter = "●".repeat(dots) + "○".repeat(5 - dots);
  const parts = [`**Conviction** ${meter}`];
  if (s.regime) parts.push(s.regime);
  if (s.kind === "retest" && s.rr != null) parts.push(`R:R ${s.rr}`);
  if (s.liqNote?.includes("⬆️")) parts.push("🟪 liq ⬆️");
  else if (s.liqNote?.includes("⬇️")) parts.push("🟧 liq ⬇️");
  return parts.join(" · ");
}

/** Build the Discord embed payload for one signal. */
export function signalEmbed(s: Signal) {
  const icon = ICON[s.kind] ?? "•";
  const fields: EmbedField[] = [
    { name: "Zone", value: `${s.zonePrice} (${s.zoneKind})`, inline: true },
    { name: "Strength", value: `${s.strength}/100 ${bar(s.strength)}`, inline: true },
  ];
  if (s.regime) {
    fields.push({ name: "Regime", value: s.regime, inline: true });
  }
  if (s.liqNote) {
    fields.push({ name: "Liquidity", value: s.liqNote, inline: false });
  }
  if (s.kind === "break" && s.breakRating != null) {
    fields.push({ name: "Break rating", value: `${s.breakRating}/100`, inline: true });
  }
  if (s.kind === "retest") {
    fields.push(
      { name: "Entry", value: String(s.entry), inline: true },
      { name: "Stop", value: String(s.stop), inline: true },
      { name: "Target", value: String(s.target), inline: true },
      { name: "R:R", value: String(s.rr), inline: true },
    );
    if (s.winrateNote) {
      fields.push({ name: "Note", value: s.winrateNote, inline: false });
    }
  }
  return {
    title: `${icon} ${s.symbol}  ${s.kind.toUpperCase()}  @ ${s.price}`,
    description: `${convictionLine(s)}\n${s.detail}`,
    color: COLOR[s.kind] ?? 0x95a5a6,
    fields,
    footer: { text: "Conviction = setup cleanliness, not win probability" },
  };
}

/** Build the Discord embed for a round-level crossing. */
export function levelEmbed(c: LevelCross) {
  const up = c.direction === "up";
  const fmt = (n: number) => n.toLocaleString("en-US");
  return {
    title: `${up ? "🟢 ⬆️" : "🔴 ⬇️"} ${c.symbol} crossed ${fmt(c.level)} ${up ? "UP" : "DOWN"}`,
    description: `Price ${up ? "broke above" : "dropped below"} the ${fmt(c.level)} round level — now ${fmt(c.price)}`,
    color: up ? 0x2ecc71 : 0xe74c3c,
  };
}

/** POST a batch of embeds to the webhook (chunked at Discord's 10/message). */
async function postEmbeds(embeds: object[]): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || embeds.length === 0) return;
  for (let i = 0; i < embeds.length; i += 10) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: embeds.slice(i, i + 10) }),
      });
    } catch {
      // never let alerting crash the cron run
    }
  }
}

/** POST zone signals to the Discord channel webhook. No-op if unconfigured. */
export async function sendDiscord(signals: Signal[]): Promise<void> {
  await postEmbeds(signals.map(signalEmbed));
}

/** POST round-level crossings to the Discord channel webhook. */
export async function sendLevelCrosses(crosses: LevelCross[]): Promise<void> {
  await postEmbeds(crosses.map(levelEmbed));
}

export interface TradeEntry {
  symbol: string;
  dir: number;
  entry: number;
  stop: number;
  target: number;
  rr?: number;
  riskUsd: number;
  regime?: string;
  liqNote?: string;
}

/** Alert when the bot opens a tracked paper trade (the entry). */
export async function sendTradeEntry(t: TradeEntry): Promise<void> {
  const side = t.dir > 0 ? "LONG" : "SHORT";
  const fields: EmbedField[] = [
    { name: "Stop", value: String(t.stop), inline: true },
    { name: "Target", value: String(t.target), inline: true },
    { name: "R:R", value: String(t.rr ?? "—"), inline: true },
    { name: "Risk", value: `$${t.riskUsd}`, inline: true },
  ];
  if (t.regime) fields.push({ name: "Regime", value: t.regime, inline: true });
  if (t.liqNote) fields.push({ name: "Liquidity", value: t.liqNote, inline: false });
  await postEmbeds([
    {
      title: `📥 BOT ENTRY · ${t.symbol} ${side} @ ${t.entry}`,
      description: "Paper trade opened — tracked in the journal",
      color: 0x3498db,
      fields,
      footer: { text: "paper trade — journal tracked" },
    },
  ]);
}

export interface TradeExit {
  symbol: string;
  dir: number;
  outcome: "win" | "loss" | "expired";
  exitPrice: number;
  R: number;
  pnlUsd: number;
}

/** Alert when a tracked paper trade closes (take-profit / stop / expired). */
export async function sendTradeExit(t: TradeExit): Promise<void> {
  const side = t.dir > 0 ? "LONG" : "SHORT";
  const head =
    t.outcome === "win"
      ? "🟢 TAKE PROFIT"
      : t.outcome === "loss"
        ? "🔴 STOP HIT"
        : "⏱️ EXPIRED";
  const color =
    t.outcome === "win" ? 0x2ecc71 : t.outcome === "loss" ? 0xe74c3c : 0x95a5a6;
  await postEmbeds([
    {
      title: `${head} · ${t.symbol} ${side} @ ${t.exitPrice}`,
      description: `${t.R >= 0 ? "+" : ""}${t.R}R · ${t.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(t.pnlUsd)}`,
      color,
      footer: { text: "paper trade — journal tracked" },
    },
  ]);
}
