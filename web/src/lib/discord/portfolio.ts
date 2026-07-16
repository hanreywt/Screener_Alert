/**
 * /position and /current-portfolio — account-wide views of the PAPER journal
 * (lib/journal.ts). /position lists the bot's open paper trades marked to live
 * price; /current-portfolio summarises the forward record. Both are paper, Tier
 * 0 — never real capital, never a recommendation. See docs/discord-surfaces.md.
 */
import { getStats } from "../journal";
import { getPrice } from "../binance";
import { EDGE_STATUS, CONFIG } from "../config";

const COLOR = { position: 0x1abc9c, portfolio: 0x9b59b6, flat: 0x95a5a6 };

// One open paper trade as stored by the journal (subset we render).
interface OpenPos {
  symbol: string; dir: 1 | -1; entry: number; stop: number; target: number;
  risk: number; ts: number; rr: number; regime?: string; lastR?: number;
}

/** Price format that adapts to magnitude (BTC ~64000 vs ONDO ~0.31). */
function fmtPrice(n: number): string {
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

function ageStr(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const signR = (r: number) => `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;

/** Live price per unique symbol; NaN for any that fail (rendered as "—"). */
async function livePrices(symbols: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(symbols)];
  const pairs = await Promise.all(
    uniq.map(async (s) => [s, await getPrice(s).catch(() => NaN)] as const),
  );
  return Object.fromEntries(pairs);
}

/** Unrealized R marked to a live price, falling back to the last stored mark. */
function liveR(o: OpenPos, price: number): number {
  if (!Number.isFinite(price) || o.risk <= 0) return o.lastR ?? 0;
  return ((price - o.entry) * o.dir) / o.risk;
}

export async function buildPositionEmbed() {
  const stats = await getStats();
  const open = stats.open as OpenPos[];
  if (!open.length) {
    return {
      title: "📈 Open paper positions",
      description: "No open positions right now. The bot opens one automatically when a retest signal fires.",
      color: COLOR.flat,
      footer: { text: "paper — Tier 0, not real capital" },
    };
  }
  const prices = await livePrices(open.map((o) => o.symbol));
  let totalR = 0;
  const lines = [...open]
    .sort((a, b) => a.ts - b.ts)
    .map((o) => {
      const p = prices[o.symbol];
      const r = liveR(o, p);
      totalR += r;
      const side = o.dir > 0 ? "LONG" : "SHORT";
      const dot = r >= 0 ? "🟢" : "🔴";
      const now = Number.isFinite(p) ? `now ${fmtPrice(p)}` : "now —";
      return `${dot} **${o.symbol}** ${side} @ ${fmtPrice(o.entry)} · ${now} · **${signR(r)}** · SL ${fmtPrice(o.stop)} / TP ${fmtPrice(o.target)} · ${ageStr(o.ts)}`;
    });
  return {
    title: `📈 Open paper positions (${open.length})`,
    description: lines.join("\n"),
    color: COLOR.position,
    fields: [{ name: "Unrealized (sum)", value: signR(totalR), inline: true }],
    footer: { text: "paper — Tier 0, not real capital · R marked to live price" },
  };
}

export async function buildPortfolioEmbed() {
  const s = await getStats();
  const open = s.open as OpenPos[];
  const prices = open.length ? await livePrices(open.map((o) => o.symbol)) : {};
  const openR = open.reduce((a, o) => a + liveR(o, prices[o.symbol]), 0);

  const wr = s.winRate == null ? "—" : `${s.winRate}%`;
  const exp = s.expectancyR == null ? "—" : signR(s.expectancyR).replace(".00R", "R");
  const usd = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US")}`;

  return {
    title: "📊 Paper portfolio",
    description: EDGE_STATUS,
    color: COLOR.portfolio,
    fields: [
      { name: "Open", value: open.length ? `${open.length} · ${signR(openR)} unreal.` : "none", inline: true },
      { name: "Resolved", value: `${s.trades} · ${wr} win`, inline: true },
      { name: "Expectancy", value: exp, inline: true },
      { name: "Cumulative", value: signR(s.totalR).replace(".00R", "R"), inline: true },
      { name: "Paper balance", value: `$${s.balanceUsd.toLocaleString("en-US")} (${usd(s.pnlUsd)})`, inline: true },
      { name: "Win / Loss / Exp", value: `${s.wins} / ${s.losses} / ${s.expired}`, inline: true },
    ],
    footer: { text: `paper — Tier 0 · $${s.startEquity.toLocaleString("en-US")} ref acct @ ${(CONFIG.riskPerTrade * 100).toFixed(1)}%/trade` },
  };
}
