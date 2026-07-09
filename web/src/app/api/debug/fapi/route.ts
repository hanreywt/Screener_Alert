import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** TEMPORARY probe: can this Vercel region reach Binance futures (OI data)? */
export async function GET() {
  const url =
    "https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=3";
  try {
    const res = await fetch(url);
    const text = await res.text();
    return NextResponse.json({
      reachable: res.ok,
      status: res.status,
      sample: text.slice(0, 300),
    });
  } catch (e) {
    return NextResponse.json({ reachable: false, error: String(e) });
  }
}
