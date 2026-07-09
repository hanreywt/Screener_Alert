import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** TEMPORARY probe: which perp/OI data sources can Vercel-US reach? */
const TARGETS: Record<string, string> = {
  binance: "https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=2",
  bybit: "https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=2",
  okx: "https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP",
  hyperliquid_meta: "https://api.hyperliquid.xyz/info",
};

export async function GET() {
  const out: Record<string, unknown> = {};
  for (const [name, url] of Object.entries(TARGETS)) {
    try {
      const isHL = name.startsWith("hyperliquid");
      const res = await fetch(url, {
        method: isHL ? "POST" : "GET",
        headers: isHL ? { "Content-Type": "application/json" } : {},
        body: isHL ? JSON.stringify({ type: "metaAndAssetCtxs" }) : undefined,
      });
      const text = await res.text();
      out[name] = { ok: res.ok, status: res.status, sample: text.slice(0, 160) };
    } catch (e) {
      out[name] = { ok: false, error: String(e) };
    }
  }
  return NextResponse.json(out);
}
