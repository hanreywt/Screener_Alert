"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { SYMBOLS } from "@/lib/config";
import type { Analysis } from "@/lib/types";
import { fmt } from "@/lib/ui";
import ZoneTable from "@/components/ZoneTable";
import AlertsFeed from "@/components/AlertsFeed";
import VolumeProfilePanel from "@/components/VolumeProfilePanel";
import KeyLevels from "@/components/KeyLevels";

// chart uses browser-only canvas APIs
const ChartPanel = dynamic(() => import("@/components/ChartPanel"), {
  ssr: false,
  loading: () => <div className="h-[440px] w-full animate-pulse rounded bg-zinc-900/50" />,
});

const REFRESH_MS = 30_000;

export default function Dashboard() {
  const [all, setAll] = useState<Record<string, Analysis>>({});
  const [selected, setSelected] = useState<string>(SYMBOLS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        SYMBOLS.map(async (s) => {
          const r = await fetch(`/api/analysis?symbol=${s}`, { cache: "no-store" });
          if (!r.ok) throw new Error(`${s}: ${r.status}`);
          return [s, (await r.json()) as Analysis] as const;
        }),
      );
      setAll(Object.fromEntries(results));
      setError(null);
      setLastUpdate(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const current = all[selected];
  const globalSignals = useMemo(
    () =>
      SYMBOLS.flatMap((s) => all[s]?.signals ?? []).sort((a, b) => {
        const rank = { retest: 0, break: 1, watch: 2 } as const;
        return rank[a.kind] - rank[b.kind] || b.strength - a.strength;
      }),
    [all],
  );

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 text-zinc-100">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">⚡ S/R Engine</h1>
          <p className="text-sm text-zinc-500">
            Volume-weighted support/resistance · break-and-retest alerts · live
            Binance data
          </p>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex gap-2 text-sm">
            <span className="rounded-lg border border-zinc-500 bg-zinc-800 px-3 py-1.5">
              Screener
            </span>
            <Link
              href="/journal"
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 hover:border-zinc-700"
            >
              Journal
            </Link>
            <Link
              href="/projection"
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 hover:border-zinc-700"
            >
              Projection
            </Link>
          </nav>
          <div className="text-right text-xs text-zinc-500">
            {error ? (
              <span className="text-red-400">error: {error}</span>
            ) : (
              <>
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />{" "}
                live · refresh 30s
                {lastUpdate > 0 && (
                  <div>updated {new Date(lastUpdate).toLocaleTimeString()}</div>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* symbol selector */}
      <div className="mb-5 flex flex-wrap gap-2">
        {SYMBOLS.map((s) => {
          const a = all[s];
          const sigCount = a?.signals.length ?? 0;
          return (
            <button
              key={s}
              onClick={() => setSelected(s)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                selected === s
                  ? "border-zinc-500 bg-zinc-800"
                  : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
              }`}
            >
              <span className="font-semibold">{s.replace("USDT", "")}</span>
              {a && (
                <span className="font-mono text-xs text-zinc-400">{fmt(a.price)}</span>
              )}
              {sigCount > 0 && (
                <span className="rounded-full bg-fuchsia-500/20 px-1.5 text-[10px] font-semibold text-fuchsia-300">
                  {sigCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && !current ? (
        <div className="h-96 animate-pulse rounded-xl bg-zinc-900/50" />
      ) : current ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* chart + volume profile */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 lg:col-span-2">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">
                {selected.replace("USDT", "")}/USDT
                <span className="ml-2 font-mono text-zinc-400">{fmt(current.price)}</span>
              </h2>
              <span className="text-xs text-zinc-500">
                ATR {fmt(current.atr)} · POC {fmt(current.profile.poc)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
              <ChartPanel data={current} />
              <div className="hidden sm:block">
                <VolumeProfilePanel data={current} />
              </div>
            </div>
          </section>

          {/* alerts feed */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="mb-3 font-semibold">
              🔔 Alerts{" "}
              <span className="text-xs font-normal text-zinc-500">(all symbols)</span>
            </h2>
            <AlertsFeed signals={globalSignals} />
          </section>

          {/* previous day/week high-low — reference only, drives nothing */}
          <div className="lg:col-span-3">
            <KeyLevels data={current} />
          </div>

          {/* zone table */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 lg:col-span-3">
            <h2 className="mb-3 font-semibold">
              Ranked Zones — {selected.replace("USDT", "")}
            </h2>
            <ZoneTable data={current} />
          </section>
        </div>
      ) : null}

      <footer className="mt-8 text-center text-xs text-zinc-600">
        Screener, not financial advice. Strength = volume·touches·rejection·
        confluence·recency. Highest-winrate play: break-and-retest of strong zones
        (R:R ≥ 1.5).
      </footer>
    </main>
  );
}
