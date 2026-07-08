import type { Signal } from "./types";

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

/** Build the Discord embed payload for one signal. */
export function signalEmbed(s: Signal) {
  const icon = ICON[s.kind] ?? "•";
  const fields: EmbedField[] = [
    { name: "Zone", value: `${s.zonePrice} (${s.zoneKind})`, inline: true },
    { name: "Strength", value: `${s.strength}/100 ${bar(s.strength)}`, inline: true },
  ];
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
    description: s.detail,
    color: COLOR[s.kind] ?? 0x95a5a6,
    fields,
  };
}

/** POST signals to the Discord channel webhook. No-op if unconfigured. */
export async function sendDiscord(signals: Signal[]): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || signals.length === 0) return;
  // Discord allows up to 10 embeds per message; chunk to be safe.
  for (let i = 0; i < signals.length; i += 10) {
    const embeds = signals.slice(i, i + 10).map(signalEmbed);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds }),
      });
    } catch {
      // never let alerting crash the cron run
    }
  }
}
