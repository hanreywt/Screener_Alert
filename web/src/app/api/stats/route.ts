import { NextResponse } from "next/server";
import { getStats } from "@/lib/journal";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Live track record of retest signals (behind the dashboard auth gate).
 * Populated by the cron alerter over time — win rate & expectancy in R.
 */
export async function GET() {
  const stats = await getStats();
  return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
}
