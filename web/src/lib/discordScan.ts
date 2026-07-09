import { analyze } from "./analysis";
import { CONFIG, SYMBOLS, type Symbol } from "./config";
import { getLiqMap } from "./liquidations";
import { fetchOiSnapshot } from "./derivatives";

/** Normalize user input ("btc", "eth") to a full symbol ("BTCUSDT"). */
export function normalizeSymbol(input: string): Symbol | null {
  let s = input.trim().toUpperCase();
  if (!s.endsWith("USDT")) s += "USDT";
  return (SYMBOLS as readonly string[]).includes(s) ? (s as Symbol) : null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });
}

/**
 * Build a Discord embed answering `/scan <symbol>` — the range we're watching:
 * nearest strong support below and resistance above, value area, top zones,
 * and any live signals.
 */
export async function buildScanEmbed(symbol: Symbol) {
  const a = await analyze(symbol);
  const strong = a.zones.filter((z) => z.strength >= CONFIG.minStrengthAlert);

  const above = strong
    .filter((z) => z.price > a.price)
    .sort((x, y) => x.price - y.price);
  const below = strong
    .filter((z) => z.price < a.price)
    .sort((x, y) => y.price - x.price);
  const res = above[0];
  const sup = below[0];

  const rangeLine = [
    sup ? `🟢 Support **${fmt(sup.price)}** (${sup.strength})` : "🟢 Support — none nearby",
    `▮ price **${fmt(a.price)}**`,
    res ? `🔴 Resistance **${fmt(res.price)}** (${res.strength})` : "🔴 Resistance — none nearby",
  ].join("\n");

  const topZones =
    strong
      .slice(0, 6)
      .map(
        (z) =>
          `\`${z.strength.toString().padStart(4)}\` ${z.kind === "support" ? "🟢" : "🔴"} ${fmt(z.price)}` +
          (z.tags.length ? `  _${z.tags.join(",")}_` : ""),
      )
      .join("\n") || "_no zones ≥ min strength_";

  const signalsLine =
    a.signals.length > 0
      ? a.signals
          .map((s) => `${s.kind.toUpperCase()} @ ${fmt(s.zonePrice)} (${s.strength})`)
          .join("\n")
      : "_none right now_";

  const regimeIcon =
    a.regime === "trend_up" ? "📈" : a.regime === "trend_down" ? "📉" : "↔️";

  // Derivatives context (funding + estimated liquidation clusters).
  const [liq, oi] = await Promise.all([
    getLiqMap(symbol, a.price),
    fetchOiSnapshot([symbol]),
  ]);
  const funding = oi[symbol]?.funding;
  const fundingTxt =
    funding != null ? ` · funding ${(funding * 100).toFixed(4)}%` : "";
  const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);
  const liqLine =
    liq.clusters.length > 0
      ? liq.clusters
          .slice(0, 4)
          .map((c) => `${c.side === "short" ? "🟪 ⬆️" : "🟧 ⬇️"} ${fmt(c.price)} (${usd(c.notionalUsd)})`)
          .join("\n") + `\n_bias ${liq.bias > 0 ? "+" : ""}${liq.bias} · est., not a hold signal_`
      : `_warming up (${liq.samples} OI samples)_`;

  return {
    title: `📊 ${symbol} — ${fmt(a.price)}`,
    description: `${regimeIcon} regime **${a.regime}** (ER ${a.regimeEr})${fundingTxt} · ATR ${fmt(a.atr)} · POC ${fmt(a.profile.poc)} · Value ${fmt(a.profile.val)}–${fmt(a.profile.vah)}`,
    color: 0x5865f2,
    fields: [
      { name: "Range we're watching", value: rangeLine, inline: false },
      { name: "Top zones (strength)", value: topZones, inline: false },
      { name: "Liquidation magnets (est.)", value: liqLine, inline: false },
      { name: "Live signals", value: signalsLine, inline: false },
    ],
    footer: { text: `struct ${CONFIG.structTf} · trigger ${CONFIG.triggerTf}` },
    timestamp: new Date().toISOString(),
  };
}
