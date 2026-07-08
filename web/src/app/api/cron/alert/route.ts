import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/analysis";
import { SYMBOLS, ROUND_STEP, ROUND_HYSTERESIS } from "@/lib/config";
import { filterUnseen } from "@/lib/dedupe";
import { sendDiscord, sendLevelCrosses } from "@/lib/discord";
import { checkLevelCross, type LevelCross } from "@/lib/roundLevels";
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
  const levelChecks: Promise<LevelCross[]>[] = [];

  const results = await Promise.allSettled(SYMBOLS.map((s) => analyze(s)));
  results.forEach((res, i) => {
    const sym = SYMBOLS[i];
    if (res.status === "fulfilled") {
      collected.push(...res.value.signals);
      const step = ROUND_STEP[sym];
      if (step)
        levelChecks.push(
          checkLevelCross(sym, res.value.price, step, step * ROUND_HYSTERESIS),
        );
    } else {
      errors[sym] = String(res.reason);
    }
  });

  const [fresh, crossesNested] = await Promise.all([
    filterUnseen(collected),
    Promise.all(levelChecks),
  ]);
  const crosses = crossesNested.flat();

  await Promise.all([sendDiscord(fresh), sendLevelCrosses(crosses)]);

  return NextResponse.json(
    {
      ok: true,
      scanned: SYMBOLS.length,
      found: collected.length,
      sent: fresh.length,
      crossed: crosses.length,
      errors: Object.keys(errors).length ? errors : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
