"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Projection, Mode } from "@/lib/projection";
import { HORIZONS } from "@/lib/projection";
import ProjectionChart from "@/components/ProjectionChart";
import MonthlyReturnsTable from "@/components/MonthlyReturnsTable";

const fmtPrice = (v: number) =>
  v >= 1000
    ? `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`
    : `$${v.toFixed(v >= 1 ? 0 : 2)}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const mult = (v: number, spot: number) => `${(v / spot).toFixed(2)}×`;
const monthYear = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default function ProjectionPage() {
  const [data, setData] = useState<Projection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number>(HORIZONS[0]);
  const [mode, setMode] = useState<Mode>("cycle");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/projection", { cache: "no-store" });
      if (!r.ok) throw new Error(`projection: ${r.status}`);
      setData((await r.json()) as Projection);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hz = data?.horizons[horizon];
  const bands = hz?.[mode];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 text-zinc-100">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">📈 BTC Projection</h1>
          <p className="text-sm text-zinc-500">
            Monthly history since 2013 → forward scenario cone · Monte Carlo,
            optionally conditioned on the halving cycle
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/" className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 hover:border-zinc-700">
            Screener
          </Link>
          <Link href="/journal" className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 hover:border-zinc-700">
            Journal
          </Link>
          <span className="rounded-lg border border-zinc-500 bg-zinc-800 px-3 py-1.5">Projection</span>
        </nav>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {!data || !hz || !bands ? (
        <div className="h-[460px] animate-pulse rounded-xl bg-zinc-900/50" />
      ) : (
        <>
          {/* halving-cycle banner */}
          <div className="mb-4 rounded-xl border border-indigo-900/40 bg-indigo-950/20 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-indigo-200">
                🔗 {data.cycle.monthsSinceHalving} months since the {monthYear(data.cycle.lastHalving)} halving
                — cycle year {data.cycle.cycleYear}/4
              </div>
              <div className="text-xs text-indigo-300/70">
                next halving ≈ {monthYear(data.cycle.nextHalvingEst)}
              </div>
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              Historically the <strong className="text-indigo-200">{data.cycle.phaseLabel}</strong>.
              In cycle mode, each forward month is drawn from the matching phase, so the
              path bends as it crosses into the pre-halving recovery and the next halving year.
            </div>
          </div>

          {/* history KPI row */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Spot (last close)" value={fmtPrice(data.spot)} />
            <Tile label="Sample" value={`${data.stats.months} mo`} sub={`since ${monthYear(data.stats.firstDate)}`} />
            <Tile label="Avg month" value={pct(data.stats.meanPct)} tone={data.stats.meanPct >= 0 ? "good" : "bad"} sub={`σ ${data.stats.stdPct.toFixed(1)}%`} />
            <Tile label="Median month" value={pct(data.stats.p50MoPct)} tone={data.stats.p50MoPct >= 0 ? "good" : "bad"} sub={`typical ${pct(data.stats.p25MoPct)}…${pct(data.stats.p75MoPct)}`} />
            <Tile label="Best / worst mo" value={pct(data.stats.bestPct)} tone="good" sub={`worst ${pct(data.stats.worstPct)}`} />
            {data.current?.monthToDateReturn != null ? (
              <Tile
                label={`${monthYear(data.current.time)} · MTD`}
                value={pct(data.current.monthToDateReturn * 100)}
                tone={data.current.monthToDateReturn >= 0 ? "good" : "bad"}
                sub={data.current.livePrice ? `live ${fmtPrice(data.current.livePrice)}` : "live"}
              />
            ) : (
              <Tile label="This month" value="—" sub="live pending" />
            )}
          </div>

          {/* chart + controls */}
          <section className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  value={mode}
                  onChange={(v) => setMode(v as Mode)}
                  options={[
                    { v: "cycle", label: "Halving-cycle" },
                    { v: "all", label: "All history" },
                  ]}
                />
                <Segmented
                  value={String(horizon)}
                  onChange={(v) => setHorizon(Number(v))}
                  options={HORIZONS.map((h) => ({ v: String(h), label: `${h} mo` }))}
                />
              </div>
              <Legend />
            </div>
            <ProjectionChart history={data.history} bands={bands} spot={data.spot} />
          </section>

          {/* endpoint outcomes at the selected horizon */}
          <section className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="mb-1 text-sm font-semibold text-zinc-300">
              Where {horizon} months lands{" "}
              <span className="font-normal text-zinc-500">
                ({mode === "cycle" ? "halving-cycle" : "all-history"} · from {fmtPrice(data.spot)},{" "}
                {monthYear(data.history[data.history.length - 1].time)} → {monthYear(bands.fan[bands.fan.length - 1].time)})
              </span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3">Scenario</th>
                    <th className="py-2 pr-3 text-right">Price</th>
                    <th className="py-2 pr-3 text-right">vs spot</th>
                    <th className="py-2">Basis</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <Row label="Bull" color="#34d399" price={bands.end.bull} spot={data.spot} basis="compounding p75 months" />
                  <Row label="Fan p90" color="#818cf8" price={bands.end.p90} spot={data.spot} basis="Monte Carlo 90th pct" />
                  <Row label="Base / median" color="#fbbf24" price={bands.end.base} spot={data.spot} basis="compounding median months" />
                  <Row label="Fan median" color="#e4e4e7" price={bands.end.p50} spot={data.spot} basis="Monte Carlo 50th pct" />
                  <Row label="Fan p10" color="#818cf8" price={bands.end.p10} spot={data.spot} basis="Monte Carlo 10th pct" />
                  <Row label="Bear" color="#f87171" price={bands.end.bear} spot={data.spot} basis="compounding p25 months" />
                </tbody>
              </table>
            </div>
          </section>

          {/* halving-phase returns table */}
          <section className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="mb-1 text-sm font-semibold text-zinc-300">
              Return by halving-cycle phase{" "}
              <span className="font-normal text-zinc-500">(the engine behind cycle mode)</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3">Cycle year</th>
                    <th className="py-2 pr-3">Phase</th>
                    <th className="py-2 pr-3 text-right">Median /mo</th>
                    <th className="py-2 pr-3 text-right">Median /yr</th>
                    <th className="py-2 pr-3 text-right">Avg /mo</th>
                    <th className="py-2 pr-3 text-right">Sample</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.cycle.buckets.map((b) => {
                    const here = b.year === data.cycle.cycleYear;
                    return (
                      <tr key={b.year} className={`border-t border-zinc-800/70 ${here ? "bg-indigo-950/30" : ""}`}>
                        <td className="py-2 pr-3 font-medium text-zinc-200">
                          Y{b.year}
                          {here && <span className="ml-2 rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs text-indigo-300">now</span>}
                        </td>
                        <td className="py-2 pr-3 text-zinc-400">{b.label}</td>
                        <td className={`py-2 pr-3 text-right ${b.medianPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pct(b.medianPct)}</td>
                        <td className={`py-2 pr-3 text-right ${b.medianAnnPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pct(b.medianAnnPct)}</td>
                        <td className="py-2 pr-3 text-right text-zinc-400">{pct(b.meanPct)}</td>
                        <td className="py-2 pr-3 text-right text-zinc-500">{b.n} mo</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-amber-200/70">
              Only ~3 completed halving cycles exist, so each phase is a {"<"}50-month sample.
              Real signal, thin evidence — a narrative overlay, not precision.
            </p>
          </section>

          {/* monthly returns heatmap */}
          <section className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="mb-1 text-sm font-semibold text-zinc-300">
              Monthly returns{" "}
              <span className="font-normal text-zinc-500">
                (actual since {monthYear(data.stats.firstDate)} · live current month · projected ahead)
              </span>
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              Solid = closed months · <span className="text-sky-300">sky outline •</span> = current month, live ·{" "}
              <span className="text-indigo-300">dashed</span> = projected ({mode === "cycle" ? "halving-cycle" : "all-history"},
              base case shown). Hover any projected cell for bull/base/bear.
            </p>
            <MonthlyReturnsTable history={data.history} bands={bands} spot={data.spot} current={data.current} />
          </section>

          {/* honesty note */}
          <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs leading-relaxed text-amber-200/80">
            <strong className="text-amber-300">Scenario analysis, not a forecast.</strong>{" "}
            The cone assumes BTC&apos;s future monthly returns are drawn from the same
            distribution as the past {data.stats.months} months (≈{(data.stats.months / 12).toFixed(0)} years,
            ~3 cycles) — a small, fat-tailed sample. Cycle mode narrows that to the
            matching halving phase, which is even thinner. It says nothing about{" "}
            <em>when</em> highs or lows occur and widens with √time. Read the band as
            &quot;plausible range if history rhymes,&quot; never a price target. Bull/base/bear
            compound a single quartile month (p75/p50/p25) and so deliberately ignore
            the volatility along the way — a straight line no real cycle ever follows.
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            History: Bitstamp BTC/USD month-end (2013–2017, committed) + Binance 1M
            (2017→now, cached monthly). Computed for {data.monthKey}.
          </p>
        </>
      )}
    </main>
  );
}

function Row({
  label,
  color,
  price,
  spot,
  basis,
}: {
  label: string;
  color: string;
  price: number;
  spot: number;
  basis: string;
}) {
  const up = price >= spot;
  return (
    <tr className="border-t border-zinc-800/70">
      <td className="py-2 pr-3">
        <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />
        <span className="align-middle font-medium text-zinc-200">{label}</span>
      </td>
      <td className="py-2 pr-3 text-right font-semibold" style={{ color }}>
        {fmtPrice(price)}
      </td>
      <td className={`py-2 pr-3 text-right ${up ? "text-emerald-400" : "text-red-400"}`}>
        {mult(price, spot)} ({pct((price / spot - 1) * 100)})
      </td>
      <td className="py-2 text-zinc-500">{basis}</td>
    </tr>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${
            value === o.v ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Legend() {
  const items = [
    { c: "#38bdf8", t: "history" },
    { c: "#818cf8", t: "fan p10–p90 / median" },
    { c: "#34d399", t: "bull" },
    { c: "#fbbf24", t: "base" },
    { c: "#f87171", t: "bear" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
      {items.map((i) => (
        <span key={i.t} className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: i.c }} />
          {i.t}
        </span>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const color = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
