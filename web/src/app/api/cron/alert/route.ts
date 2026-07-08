import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/analysis";
import { SYMBOLS } from "@/lib/config";
import { filterUnseen } from "@/lib/dedupe";
import { sendDiscord } from "@/lib/discord";
import type { Signal } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * Scan all symbols once, de-dupe against recent alerts, and push new
 * signals to Discord. Meant to be hit on a schedule (Vercel Cron, or a
 * free external pinger like cron-job.org on the Hobby plan).
 *
 * Secured with CRON_SECRET: caller must send `Authorization: Bearer <secret>`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const collected: Signal[] = [];
  const errors: Record<string, string> = {};

  const results = await Promise.allSettled(SYMBOLS.map((s) => analyze(s)));
  results.forEach((res, i) => {
    if (res.status === "fulfilled") {
      collected.push(...res.value.signals);
    } else {
      errors[SYMBOLS[i]] = String(res.reason);
    }
  });

  const fresh = await filterUnseen(collected);
  await sendDiscord(fresh);

  return NextResponse.json(
    {
      ok: true,
      scanned: SYMBOLS.length,
      found: collected.length,
      sent: fresh.length,
      errors: Object.keys(errors).length ? errors : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
