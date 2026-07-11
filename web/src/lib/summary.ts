import { SYMBOLS, CONFIG } from "./config";
import { getKlines } from "./binance";
import { classifyRegime } from "./regime";
import type { Candle } from "./types";

/**
 * Daily market report — one Discord post per day, to its own channel.
 *
 * Summarises the UTC day that just closed. Fired at 00:00 UTC, which is 07:00
 * WIB, so "yesterday" in the report is the day that ended as the report is sent.
 *
 * Everything here is descriptive. It carries NO signal, NO recommendation, and
 * no claim about what happens next — it's a morning briefing, not a trade idea.
 *
 * ETF flow is deliberately absent: there's no free API, the canonical free
 * source (Farside) blocks automated access, and US flows for the session that
 * just closed usually aren't published by 00:00 UTC anyway. A stale ETF number
 * presented as fresh would be worse than no number. Left as a plug-in slot.
 */

const VOL_BASELINE_DAYS = 20; // window for "was yesterday's volume normal?"

export interface SymbolSummary {
  symbol: string;
  day: string; // UTC date of the candle being reported (from the candle, not the clock)
  close: number;
  changePct: number;
  high: number;
  low: number;
  rangePct: number;
  volume: number;
  relVolume: number | null; // yesterday's volume ÷ prior 20-day average
  regime: string;
  notes: string[]; // level events worth knowing about
}

const pctOf = (a: number, b: number) => ((a - b) / b) * 100;

/** Compact number for a Discord code block (14.2k, 1.3M …). */
function humanVol(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}

function price(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });
}

async function summariseSymbol(symbol: string): Promise<SymbolSummary | null> {
  const [days, weeks, struct] = await Promise.all([
    getKlines(symbol, "1d", VOL_BASELINE_DAYS + 5),
    getKlines(symbol, "1w", 3),
    getKlines(symbol, CONFIG.structTf, CONFIG.structLookback),
  ]);
  // Last element is the day that just STARTED (00:00 UTC) — the closed day we
  // are reporting on is index -2. Same reasoning as lib/refLevels.ts.
  if (days.length < 4) return null;
  const y = days[days.length - 2]; // yesterday (closed)
  const prior = days[days.length - 3]; // the day before it

  // Volume baseline: the 20 closed days BEFORE yesterday, so yesterday isn't
  // compared against a window that includes itself.
  const base = days.slice(-(VOL_BASELINE_DAYS + 2), -2);
  const avgVol =
    base.length > 0 ? base.reduce((a, c) => a + c.volume, 0) / base.length : 0;

  const notes: string[] = [];
  if (y.high > prior.high) {
    notes.push(
      y.close > prior.high
        ? `broke above prior-day high ${price(prior.high)} and held`
        : `swept prior-day high ${price(prior.high)} then closed back below`,
    );
  }
  if (y.low < prior.low) {
    notes.push(
      y.close < prior.low
        ? `broke below prior-day low ${price(prior.low)} and held`
        : `swept prior-day low ${price(prior.low)} then closed back above`,
    );
  }
  // Weekly context: last CLOSED week.
  const w = weeks.length >= 2 ? weeks[weeks.length - 2] : null;
  if (w) {
    if (y.close > w.high) notes.push(`closed above prev-week high ${price(w.high)}`);
    else if (y.close < w.low) notes.push(`closed below prev-week low ${price(w.low)}`);
  }

  const regime = classifyRegime(
    struct as Candle[],
    CONFIG.regimeLookback,
    CONFIG.regimeMinEr,
  ).regime;

  return {
    symbol,
    day: new Date(y.time * 1000).toISOString().slice(0, 10),
    close: y.close,
    changePct: pctOf(y.close, y.open),
    high: y.high,
    low: y.low,
    rangePct: pctOf(y.high, y.low),
    volume: y.volume,
    relVolume: avgVol > 0 ? y.volume / avgVol : null,
    regime,
    notes,
  };
}

export async function buildSummary() {
  const rows = (
    await Promise.all(SYMBOLS.map((s) => summariseSymbol(s).catch(() => null)))
  ).filter((r): r is SymbolSummary => r !== null);

  if (!rows.length) return null;

  // The date comes from the CANDLE we're reporting, never from the clock. The
  // cron fires at exactly 00:00 UTC — the moment the day rolls — so `now - 1d`
  // and "the last closed daily candle" can disagree by a day right at the
  // boundary, which would both mislabel the report and break the once-per-day
  // guard keyed on it.
  const day = rows[0].day;

  // Fixed-width table — Discord renders code blocks in a monospace font, which
  // is the only way to get columns to line up in a message.
  const header = "COIN    CLOSE        CHG      RANGE    VOL     vs20d  REGIME";
  const lines = rows.map((r) => {
    const coin = r.symbol.replace("USDT", "").padEnd(6);
    const close = price(r.close).padStart(11);
    const chg = `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`.padStart(8);
    const range = `${r.rangePct.toFixed(1)}%`.padStart(7);
    const vol = humanVol(r.volume).padStart(7);
    const rel =
      r.relVolume == null
        ? "    —".padStart(6)
        : `${r.relVolume.toFixed(1)}×`.padStart(6);
    return `${coin}${close} ${chg} ${range} ${vol} ${rel}  ${r.regime}`;
  });

  const notes = rows
    .filter((r) => r.notes.length)
    .map((r) => `• **${r.symbol.replace("USDT", "")}** — ${r.notes.join("; ")}`);

  const up = rows.filter((r) => r.changePct > 0).length;
  const down = rows.filter((r) => r.changePct < 0).length;

  const description = [
    "```",
    header,
    ...lines,
    "```",
    `${up} up · ${down} down · vs20d = yesterday's volume ÷ its prior ${VOL_BASELINE_DAYS}-day average`,
    ...(notes.length ? ["", "**Level events**", ...notes] : []),
  ].join("\n");

  return {
    day,
    embed: {
      title: `📊 Daily Report · ${day} (UTC)`,
      description,
      color: 0x5865f2,
      footer: {
        text: "Descriptive only — no signal, no recommendation. Edge is unproven (Tier 0).",
      },
    },
  };
}
