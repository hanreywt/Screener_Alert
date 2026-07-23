import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/analysis";
import { SYMBOLS, ROUND_STEP, ROUND_HYSTERESIS, LIQ_ALERT } from "@/lib/config";
import { filterUnseen } from "@/lib/dedupe";
import { sendDiscord, sendLevelCrosses, sendLiqClusters } from "@/lib/discord/alerts";
import { checkLevelCross, type LevelCross } from "@/lib/roundLevels";
import { logSignals, resolveOpen, forwardNotes } from "@/lib/journal";
import { fetchOiSnapshot } from "@/lib/derivatives";
import {
  recordOiSample,
  getLiqMap,
  formatLiqNote,
  findLiqAlerts,
  filterLiqCooldown,
  topClusterUsd,
  type LiqAlert,
} from "@/lib/liquidations";
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
  const priceBySymbol: Record<string, number> = {};

  const results = await Promise.allSettled(SYMBOLS.map((s) => analyze(s)));
  results.forEach((res, i) => {
    const sym = SYMBOLS[i];
    if (res.status === "fulfilled") {
      collected.push(...res.value.signals);
      priceBySymbol[sym] = res.value.price;
      const step = ROUND_STEP[sym];
      if (step)
        levelChecks.push(
          checkLevelCross(sym, res.value.price, step, step * ROUND_HYSTERESIS),
        );
    } else {
      errors[sym] = String(res.reason);
    }
  });

  // Derivatives: record an OI sample per symbol (accumulates the liq-map
  // history forward), then build each symbol's liq map for context.
  const oi = await fetchOiSnapshot(SYMBOLS);
  await Promise.all(
    Object.entries(oi).map(([sym, s]) => recordOiSample(sym, s.oiUsd, s.mark)),
  );
  const [fresh, crossesNested] = await Promise.all([
    filterUnseen(collected),
    Promise.all(levelChecks),
  ]);
  const crosses = crossesNested.flat();

  // Liq maps are the most expensive thing in this route — each one LRANGEs up
  // to 3000 stored OI samples out of Redis. Build them ONLY where they're
  // consumed: the alert symbols (needed every run) plus symbols that actually
  // produced a signal to annotate. Previously all five were built every tick
  // and then discarded, since `fresh` is empty on most runs.
  const liqSymbols = [
    ...new Set<string>([...LIQ_ALERT.symbols, ...fresh.map((s) => s.symbol)]),
  ];
  const liqNoteBySymbol: Record<string, string> = {};
  const liqCandidates: LiqAlert[] = [];
  const liqTop: Record<string, { long: number; short: number }> = {};
  await Promise.all(
    liqSymbols.map(async (sym) => {
      const price = priceBySymbol[sym];
      if (price == null) return;
      const map = await getLiqMap(sym, price);
      const note = formatLiqNote(map);
      if (note) liqNoteBySymbol[sym] = note;
      // Cluster ALERTS are additive: anything they throw must degrade to "no
      // liq alert this run", never take the zone alerts down with them.
      if ((LIQ_ALERT.symbols as readonly string[]).includes(sym)) {
        try {
          liqTop[sym] = topClusterUsd(map); // observability: watch the real scale
          liqCandidates.push(...findLiqAlerts(sym, map, price));
        } catch {
          // ignore — the liqNote above still rides along on zone alerts
        }
      }
    }),
  );
  const liqAlerts = await filterLiqCooldown(liqCandidates).catch(() => []);
  // Attach the MEASURED forward record for each symbol. The alert used to assert
  // a "~60-70% winrate" that nothing here ever measured; it now carries what the
  // signal has actually done on that token, and updates itself as evidence lands.
  const notes = await forwardNotes();
  for (const s of fresh) {
    s.liqNote = liqNoteBySymbol[s.symbol];
    s.recordNote = notes[s.symbol];
  }

  // Track record: resolve open paper trades vs current price, then log new ones.
  await resolveOpen(priceBySymbol);
  await logSignals(fresh);

  // Retests are alerted as "BOT ENTRY" by the journal (logSignals) — don't
  // also send the generic retest signal embed, to avoid doubling.
  await Promise.all([
    sendDiscord(fresh.filter((s) => s.kind !== "retest")),
    sendLevelCrosses(crosses),
    sendLiqClusters(liqAlerts).catch(() => {}),
  ]);

  return NextResponse.json(
    {
      ok: true,
      scanned: SYMBOLS.length,
      found: collected.length,
      sent: fresh.length,
      crossed: crosses.length,
      liqAlerts: liqAlerts.length,
      // Largest estimated cluster per side, always reported: lets you watch the
      // real distribution and calibrate LIQ_ALERT.minNotionalUsd from data
      // rather than from whether an alert happened to fire.
      liqTop,
      errors: Object.keys(errors).length ? errors : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
