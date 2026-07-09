const HL = "https://api.hyperliquid.xyz/info";

export interface OiSnap {
  oiUsd: number;
  funding: number; // hourly funding rate
  mark: number;
}

interface HlCtx {
  openInterest: string;
  markPx: string;
  funding: string;
}

/**
 * One Hyperliquid call returns OI + funding + mark for every asset. We map our
 * USDT symbols (BTCUSDT → BTC) onto it. Hyperliquid is a single perp DEX, so
 * this is a *subset* of total market OI — real, free, and US-reachable (Binance
 * futures is geo-blocked from Vercel), good enough for a directional liq proxy.
 */
export async function fetchOiSnapshot(
  symbols: readonly string[],
): Promise<Record<string, OiSnap>> {
  const out: Record<string, OiSnap> = {};
  try {
    const res = await fetch(HL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    if (!res.ok) return out;
    const data = (await res.json()) as [{ universe: { name: string }[] }, HlCtx[]];
    const names = data[0].universe.map((u) => u.name);
    const ctxs = data[1];
    for (const sym of symbols) {
      const hl = sym.replace(/USDT$/, "");
      const i = names.indexOf(hl);
      if (i < 0) continue;
      const c = ctxs[i];
      const mark = parseFloat(c.markPx);
      if (!Number.isFinite(mark)) continue;
      out[sym] = {
        oiUsd: parseFloat(c.openInterest) * mark,
        funding: parseFloat(c.funding),
        mark,
      };
    }
  } catch {
    // never let a data hiccup crash the run
  }
  return out;
}
