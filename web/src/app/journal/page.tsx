"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Trade {
  symbol: string;
  dir: number;
  outcome: "win" | "loss" | "expired";
  R: number;
  rr?: number;
  riskPct?: number;
  sizeNotional?: number;
  mfe: number;
  mae: number;
  regime?: string;
  openedAt: number;
  resolvedAt: number;
}
interface OpenTrade {
  symbol: string;
  dir: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  riskPct: number;
  sizeNotional: number;
  mfe: number;
  mae: number;
  lastR?: number;
  regime?: string;
  ts: number;
}
interface Journal {
  fired: { watch: number; break: number; retest: number };
  trades: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number | null;
  expectancyR: number | null;
  totalR: number;
  startEquity: number;
  riskUsd: number;
  pnlUsd: number;
  balanceUsd: number;
  recent: Trade[];
  open: OpenTrade[];
}

const REFRESH_MS = 30_000;
const fmtR = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
const fmtUsd = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const px = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });
const fmtAge = (ts: number) => {
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function JournalPage() {
  const [j, setJ] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/stats", { cache: "no-store" });
      if (!r.ok) throw new Error(`stats: ${r.status}`);
      setJ((await r.json()) as Journal);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Equity curve: cumulative R over resolved trades, oldest → newest.
  const equity = useMemo(() => {
    if (!j) return [];
    const chrono = [...j.recent].sort((a, b) => a.resolvedAt - b.resolvedAt);
    let cum = 0;
    return chrono.map((t) => ({ t, cum: (cum += t.R) }));
  }, [j]);

  const totalR = equity.length ? equity[equity.length - 1].cum : 0;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 text-zinc-100">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">📓 Journal · PnL</h1>
          <p className="text-sm text-zinc-500">
            Forward paper-trade record of retest signals · risk measured in R
            (1R = one unit of risk)
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link
            href="/"
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 hover:border-zinc-700"
          >
            Screener
          </Link>
          <span className="rounded-lg border border-zinc-500 bg-zinc-800 px-3 py-1.5">
            Journal
          </span>
        </nav>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {!j ? (
        <div className="h-64 animate-pulse rounded-xl bg-zinc-900/50" />
      ) : (
        <>
          {/* KPI tiles — lead with dollars */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile
              label="Balance"
              value={fmtUsd(j.balanceUsd)}
              tone={j.pnlUsd >= 0 ? "good" : "bad"}
              sub={`from ${fmtUsd(j.startEquity)} start`}
            />
            <Tile
              label="Total PnL"
              value={`${j.pnlUsd >= 0 ? "+" : ""}${fmtUsd(j.pnlUsd)}`}
              tone={j.pnlUsd >= 0 ? "good" : "bad"}
              sub={`${((j.pnlUsd / j.startEquity) * 100).toFixed(2)}% · ${fmtR(j.totalR)}`}
            />
            <Tile
              label="Win rate"
              value={j.winRate == null ? "—" : `${j.winRate}%`}
              tone={j.winRate == null ? "neutral" : j.winRate >= 50 ? "good" : "bad"}
              sub={`${j.wins}W · ${j.losses}L${j.expired ? ` · ${j.expired}exp` : ""}`}
            />
            <Tile
              label="Expectancy"
              value={j.expectancyR == null ? "—" : fmtR(j.expectancyR)}
              tone={j.expectancyR == null ? "neutral" : j.expectancyR >= 0 ? "good" : "bad"}
              sub={`${fmtUsd(Math.round(j.riskUsd * (j.expectancyR ?? 0)))}/trade`}
            />
            <Tile label="Resolved trades" value={String(j.trades)} />
            <Tile
              label="Signals fired"
              value={String(j.fired.retest)}
              sub={`retest · ${j.fired.break} break · ${j.fired.watch} watch`}
            />
          </div>

          {/* Equity curve (dollars) */}
          <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">
              Equity curve{" "}
              <span className="font-normal text-zinc-500">
                (cumulative PnL, ${j.riskUsd}/R · last {equity.length} closed)
              </span>
            </h2>
            <EquityChart points={equity.map((e) => e.cum * j.riskUsd)} fmt={fmtUsd} />
          </section>

          {/* Running (open) trades */}
          <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">
              Running trades{" "}
              <span className="font-normal text-zinc-500">({j.open.length} open)</span>
            </h2>
            {j.open.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">
                No open trades right now.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="py-2 pr-3">Symbol</th>
                      <th className="py-2 pr-3">Side</th>
                      <th className="py-2 pr-3 text-right">Entry</th>
                      <th className="py-2 pr-3 text-right">Stop</th>
                      <th className="py-2 pr-3 text-right">Target</th>
                      <th className="py-2 pr-3 text-right">Unreal.</th>
                      <th className="py-2 pr-3 text-right">MFE</th>
                      <th className="py-2 pr-3 text-right">MAE</th>
                      <th className="py-2 pr-3 text-right">R:R</th>
                      <th className="py-2 pr-3 text-right">Size</th>
                      <th className="py-2 pr-3">Regime</th>
                      <th className="py-2 pr-3 text-right">Age</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-zinc-300">
                    {[...j.open]
                      .sort((a, b) => b.ts - a.ts)
                      .map((t, i) => (
                        <tr key={i} className="border-t border-zinc-900">
                          <td className="py-2 pr-3 font-sans font-semibold">
                            {t.symbol.replace("USDT", "")}
                          </td>
                          <td className="py-2 pr-3">{t.dir > 0 ? "LONG" : "SHORT"}</td>
                          <td className="py-2 pr-3 text-right">{px(t.entry)}</td>
                          <td className="py-2 pr-3 text-right text-red-400/80">{px(t.stop)}</td>
                          <td className="py-2 pr-3 text-right text-emerald-400/80">{px(t.target)}</td>
                          <td
                            className={`py-2 pr-3 text-right font-semibold ${(t.lastR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {t.lastR != null ? fmtR(t.lastR) : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right text-zinc-500">{t.mfe.toFixed(2)}</td>
                          <td className="py-2 pr-3 text-right text-zinc-500">{t.mae.toFixed(2)}</td>
                          <td className="py-2 pr-3 text-right text-zinc-400">{t.rr}</td>
                          <td className="py-2 pr-3 text-right text-zinc-400">
                            {t.sizeNotional != null ? `$${t.sizeNotional}` : "—"}
                          </td>
                          <td className="py-2 pr-3 font-sans text-zinc-400">{t.regime ?? "—"}</td>
                          <td className="py-2 pr-3 text-right font-sans text-zinc-500">{fmtAge(t.ts)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Resolved trades — full open→close history (also the data view) */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">
              Closed trades{" "}
              <span className="font-normal text-zinc-500">(history)</span>
            </h2>
            {j.recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                No resolved trades yet — retests resolve as price hits their
                stop or target. The record builds up over time.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="py-2 pr-3">Symbol</th>
                      <th className="py-2 pr-3">Side</th>
                      <th className="py-2 pr-3">Outcome</th>
                      <th className="py-2 pr-3 text-right">R</th>
                      <th className="py-2 pr-3 text-right">R:R</th>
                      <th className="py-2 pr-3 text-right">Risk%</th>
                      <th className="py-2 pr-3 text-right">Size</th>
                      <th className="py-2 pr-3 text-right">MFE</th>
                      <th className="py-2 pr-3 text-right">MAE</th>
                      <th className="py-2 pr-3">Regime</th>
                      <th className="py-2 pr-3">Opened</th>
                      <th className="py-2 pr-3">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-zinc-300">
                    {[...j.recent]
                      .sort((a, b) => b.resolvedAt - a.resolvedAt)
                      .map((t, i) => (
                        <tr key={i} className="border-t border-zinc-900">
                          <td className="py-2 pr-3 font-sans font-semibold">
                            {t.symbol.replace("USDT", "")}
                          </td>
                          <td className="py-2 pr-3">
                            {t.dir > 0 ? "LONG" : "SHORT"}
                          </td>
                          <td className="py-2 pr-3">
                            <Outcome outcome={t.outcome} />
                          </td>
                          <td
                            className={`py-2 pr-3 text-right ${t.R >= 0 ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {fmtR(t.R)}
                          </td>
                          <td className="py-2 pr-3 text-right text-zinc-400">
                            {t.rr ?? "—"}
                          </td>
                          <td className="py-2 pr-3 text-right text-zinc-400">
                            {t.riskPct != null ? `${t.riskPct}%` : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right text-zinc-400">
                            {t.sizeNotional != null ? `$${t.sizeNotional}` : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right text-zinc-500">
                            {t.mfe.toFixed(2)}
                          </td>
                          <td className="py-2 pr-3 text-right text-zinc-500">
                            {t.mae.toFixed(2)}
                          </td>
                          <td className="py-2 pr-3 font-sans text-zinc-400">
                            {t.regime ?? "—"}
                          </td>
                          <td className="py-2 pr-3 font-sans text-zinc-500">
                            {new Date(t.openedAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-2 pr-3 font-sans text-zinc-500">
                            {new Date(t.resolvedAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-zinc-600">
              Size = suggested notional risking 1% ($100) of a $10,000 reference
              account (journal only, never in alerts). Prices sampled per cron
              tick, so single-trade R isn&apos;t an exact fill.
            </p>
          </section>
        </>
      )}
    </main>
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
  const color =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-red-400"
        : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function Outcome({ outcome }: { outcome: string }) {
  const map: Record<string, string> = {
    win: "text-emerald-300 bg-emerald-500/15",
    loss: "text-red-300 bg-red-500/15",
    expired: "text-zinc-400 bg-zinc-500/15",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${map[outcome] ?? ""}`}
    >
      {outcome}
    </span>
  );
}

/** Single-series equity curve as inline SVG with a hover crosshair. */
function EquityChart({
  points,
  fmt = fmtR,
}: {
  points: number[];
  fmt?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = 220;
  const pad = { l: 40, r: 12, t: 12, b: 20 };

  if (points.length < 2) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-zinc-500">
        Need ≥2 closed trades to plot an equity curve ({points.length} so far).
      </div>
    );
  }

  const series = [0, ...points]; // start equity at 0
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const up = points[points.length - 1] >= 0;
  const stroke = up ? "#34d399" : "#f87171"; // emerald / red
  const line = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area = `${line} L${x(series.length - 1)},${y(min)} L${x(0)},${y(min)} Z`;
  const zeroY = y(0);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(
            ((px - pad.l) / (W - pad.l - pad.r)) * (series.length - 1),
          );
          setHover(Math.max(0, Math.min(series.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="eqfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* zero baseline */}
        <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} stroke="#3f3f46" strokeWidth="1" strokeDasharray="3 3" />
        <path d={area} fill="url(#eqfill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#71717a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(series[hover])} r="4" fill={stroke} stroke="#09090b" strokeWidth="2" />
          </>
        )}
        {/* y labels */}
        <text x={4} y={y(max) + 4} fill="#71717a" fontSize="11">{fmt(max)}</text>
        <text x={4} y={y(min) + 4} fill="#71717a" fontSize="11">{fmt(min)}</text>
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 shadow"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: "translateX(-50%)" }}>
          trade {hover} · {fmt(series[hover])}
        </div>
      )}
    </div>
  );
}
