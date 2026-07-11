import { NextRequest, NextResponse } from "next/server";
import { buildSummary } from "@/lib/summary";
import { sendSummary } from "@/lib/discord/summary";
import { getRedis } from "@/lib/redisClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * ② DAILY SUMMARY surface → its own Discord channel.
 *
 * Schedule it at 00:00 UTC (= 07:00 WIB) from cron-job.org, with
 * `Authorization: Bearer <CRON_SECRET>`. Summarises the UTC day that just closed.
 *
 *   ?dry=1   build and return the report WITHOUT posting to Discord.
 *   ?force=1 post even if today's report already went out.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";

  const built = await buildSummary();
  if (!built) {
    return NextResponse.json({ ok: false, error: "no data" }, { status: 502 });
  }
  const { day, embed } = built;

  if (dry) {
    return NextResponse.json(
      { ok: true, dry: true, day, embed },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Once per reported day, keyed on the DAY IN THE DATA (not the clock). A
  // scheduler that retries on timeout — cron-job.org does — would otherwise
  // post the same report two or three times.
  const r = getRedis();
  if (r && !force) {
    const claimed = await r.set(`summary:sent:${day}`, Date.now(), {
      nx: true,
      ex: 60 * 60 * 30, // outlive the day, expire well before the next one
    });
    if (claimed !== "OK") {
      return NextResponse.json(
        { ok: true, skipped: "already sent today", day },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  await sendSummary(embed);
  return NextResponse.json(
    { ok: true, sent: true, day },
    { headers: { "Cache-Control": "no-store" } },
  );
}
