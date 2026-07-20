import { NextResponse } from "next/server";
import { getProjection } from "@/lib/projection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * BTC monthly history since 2013 + forward scenario projection (12/24-month
 * Monte Carlo fan + bull/base/bear lines). Heavy inputs are cached monthly in
 * Redis, so a warm month returns near-instantly. See lib/projection.ts.
 */
export async function GET() {
  try {
    const data = await getProjection();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
