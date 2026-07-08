import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/analysis";
import { SYMBOLS } from "@/lib/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
  if (!SYMBOLS.includes(symbol as (typeof SYMBOLS)[number])) {
    return NextResponse.json({ error: "unknown symbol" }, { status: 400 });
  }
  try {
    const data = await analyze(symbol);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
