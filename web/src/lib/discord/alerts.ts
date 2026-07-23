/**
 * ① ALERTS surface — realtime, to the trading channel.
 *
 * Fires on: zone signals (watch/break), round-level crossings, and paper-trade
 * open/close. Retests are NOT sent as signalEmbed — the journal announces them
 * as BOT ENTRY, so the cron route filters them out to avoid double-posting.
 *
 * Every actionable alert carries `recordNote`: the MEASURED forward record for
 * that symbol plus EDGE_STATUS. Never add a claimed win rate — one used to live
 * in signals.ts ("~60-70%"), was never measured, and the backtest disproved it.
 *
 * See docs/discord-surfaces.md.
 */
import { postEmbeds } from "./transport";
import type { Signal } from "../types";
import type { LevelCross } from "../roundLevels";
import type { LiqAlert } from "../liquidations";

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
  if (s.rotationNote) {
    fields.push({ name: "Rotation", value: s.rotationNote, inline: false });
  }
  if (s.flowNote) {
    fields.push({ name: "Order flow", value: s.flowNote, inline: false });
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
    if (s.recordNote) {
      fields.push({ name: "Track record", value: s.recordNote, inline: false });
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

/** Compact notional: 82_000_000 → "$82M". */
function usdShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(a / 1e9 >= 10 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(a / 1e6 >= 10 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`;
  return `$${Math.round(a)}`;
}

const price = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/**
 * Build the Discord embed for a large estimated liquidation cluster.
 *
 * "est." is not decoration. The notional is inferred: each OI *increase* is
 * split 50/50 long/short and spread across an ASSUMED leverage mix — it is not
 * a measured stack of resting liquidation orders, and Hyperliquid is only a
 * slice of total perp OI. Deliberately no "cascade risk" wording: nothing here
 * has measured whether price actually cascades into these levels, and claiming
 * it would be the same unearned confidence EDGE_STATUS exists to prevent.
 */
export function liqClusterEmbed(a: LiqAlert) {
  const base = a.symbol.replace(/USDT$/, "");
  const long = a.side === "long";
  // Matches convictionLine's colour language: 🟧 downside, 🟪 upside.
  const color = long ? 0xe67e22 : 0x9b59b6;
  const where = long ? "below" : "above";

  return {
    title: `⚠️ HL est. ${a.side}-liq cluster ${usdShort(a.notionalUsd)} · ${base}`,
    description:
      `${a.distPct.toFixed(1)}% ${where} at ${price(a.price)} · spot ${price(a.currentPrice)} · hyperliquid:${base.toLowerCase()}\n` +
      `Estimated from Hyperliquid OI + an assumed leverage mix — not observed orders`,
    color,
    footer: { text: "estimate, not measured depth · context only, no direction claim" },
  };
}

/** POST estimated liq-cluster alerts to the Discord channel webhook. */
export async function sendLiqClusters(alerts: LiqAlert[]): Promise<void> {
  await postEmbeds(alerts.map(liqClusterEmbed));
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
  recordNote?: string;
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
  // The measured record for THIS token — the alert grades itself.
  if (t.recordNote) fields.push({ name: "Track record", value: t.recordNote, inline: false });
  await postEmbeds([
    {
      title: `📥 BOT ENTRY · ${t.symbol} ${side} @ ${t.entry}`,
      description: "Paper trade opened — tracked in the journal",
      color: 0x3498db,
      fields,
      footer: { text: "paper trade — not a recommendation. Edge is unproven (Tier 0)." },
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
