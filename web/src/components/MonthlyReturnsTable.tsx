"use client";

import { useMemo, useState } from "react";
import type { Bands, CurrentMonth, MonthPoint } from "@/lib/projection";

/**
 * Coinglass-style month-over-month return heatmap, extended forward.
 *
 * Rows = years (newest first), columns = Jan–Dec, plus Average/Median rows.
 * Three cell kinds share the grid:
 *   - actual — a closed historical month's return.
 *   - live   — the still-forming current month, month-to-date (updates live).
 *   - proj   — a future month from the selected projection: shows the base case,
 *              hover reveals bull/base/bear returns and the projected price.
 * The forming month carries both a live figure and a projection, so its tooltip
 * shows month-to-date vs. the full-month scenarios. Average/Median use closed
 * months only.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Cell {
  actual?: number;
  live?: number;
  proj?: { base: number; bull: number; bear: number; basePrice: number; bullPrice: number; bearPrice: number };
}

function returnStyle(r: number): React.CSSProperties {
  const mag = Math.min(Math.abs(r) / 0.4, 1);
  const a = 0.12 + 0.5 * mag;
  return { backgroundColor: r >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})` };
}

const fmt = (r: number | undefined) =>
  r === undefined ? "" : `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;
const fmtPrice = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : `$${v.toFixed(0)}`;

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export default function MonthlyReturnsTable({
  history,
  bands,
  spot,
  current,
}: {
  history: MonthPoint[];
  bands: Bands;
  spot: number;
  current: CurrentMonth | null;
}) {
  const [hover, setHover] = useState<{ y: number; m: number; cell: Cell; x: number; top: number } | null>(null);

  const { years, cells, avg, med } = useMemo(() => {
    const cells = new Map<string, Cell>(); // `${year}:${monthIdx}`
    const key = (ts: number) => {
      const d = new Date(ts * 1000);
      return `${d.getUTCFullYear()}:${d.getUTCMonth()}`;
    };
    const merge = (ts: number, patch: Cell) => {
      const k = key(ts);
      cells.set(k, { ...cells.get(k), ...patch });
    };

    // closed history returns
    for (let i = 1; i < history.length; i++) {
      merge(history[i].time, { actual: history[i].close / history[i - 1].close - 1 });
    }
    // future projection: per-month return from consecutive scenario levels
    const prev = (arr: { value: number }[], m: number) => (m === 0 ? spot : arr[m - 1].value);
    for (let m = 0; m < bands.base.length; m++) {
      merge(bands.base[m].time, {
        proj: {
          base: bands.base[m].value / prev(bands.base, m) - 1,
          bull: bands.bull[m].value / prev(bands.bull, m) - 1,
          bear: bands.bear[m].value / prev(bands.bear, m) - 1,
          basePrice: bands.base[m].value,
          bullPrice: bands.bull[m].value,
          bearPrice: bands.bear[m].value,
        },
      });
    }
    // live current month (takes visual precedence over its own projection)
    if (current && current.monthToDateReturn != null) {
      merge(current.time, { live: current.monthToDateReturn });
    }

    const allYears = new Set<number>();
    for (const k of cells.keys()) allYears.add(Number(k.split(":")[0]));
    const years = [...allYears].sort((a, b) => b - a);

    // Average / Median over closed actual months only.
    const avg: (number | undefined)[] = [];
    const med: (number | undefined)[] = [];
    for (let m = 0; m < 12; m++) {
      const col: number[] = [];
      for (const y of years) {
        const c = cells.get(`${y}:${m}`);
        if (c?.actual !== undefined) col.push(c.actual);
      }
      avg[m] = col.length ? col.reduce((a, b) => a + b, 0) / col.length : undefined;
      med[m] = col.length ? median(col) : undefined;
    }
    return { years, cells, avg, med };
  }, [history, bands, spot, current]);

  return (
    <div className="relative" data-grid>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-center text-xs tabular-nums">
          <thead>
            <tr className="text-zinc-500">
              <th className="px-1 py-1 text-left font-medium">Year</th>
              {MONTHS.map((m) => (
                <th key={m} className="px-1 py-1 font-medium">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td className="px-1 py-1 text-left font-semibold text-zinc-300">{y}</td>
                {MONTHS.map((_, m) => {
                  const c = cells.get(`${y}:${m}`);
                  if (!c) return <td key={m} className="px-1 py-1" />;
                  const display = c.actual ?? c.live ?? c.proj?.base;
                  const isProjOnly = c.actual === undefined && c.live === undefined;
                  const isLive = c.live !== undefined;
                  return (
                    <td
                      key={m}
                      className={`rounded px-1 py-1 ${isProjOnly ? "text-zinc-300 opacity-90" : "text-zinc-100"} ${
                        isLive ? "outline outline-1 outline-sky-400/70" : ""
                      } ${isProjOnly ? "outline-dashed outline-1 outline-indigo-500/40" : ""} ${
                        c.proj || c.actual !== undefined ? "cursor-help" : ""
                      }`}
                      style={display !== undefined ? returnStyle(display) : undefined}
                      onMouseEnter={(e) => {
                        const box = (e.currentTarget.closest("[data-grid]") as HTMLElement).getBoundingClientRect();
                        const cell = e.currentTarget.getBoundingClientRect();
                        setHover({
                          y,
                          m,
                          cell: c,
                          x: cell.left - box.left + cell.width / 2,
                          top: cell.bottom - box.top,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                    >
                      {display !== undefined ? `${display >= 0 ? "+" : ""}${(display * 100).toFixed(1)}%` : ""}
                      {isLive && <span className="ml-0.5 text-sky-300">•</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="px-1 pt-2 text-left font-semibold text-zinc-400">Average</td>
              {avg.map((r, m) => (
                <td key={m} className="rounded bg-zinc-800/60 px-1 pt-2 font-medium text-zinc-200">{fmt(r)}</td>
              ))}
            </tr>
            <tr>
              <td className="px-1 py-1 text-left font-semibold text-zinc-400">Median</td>
              {med.map((r, m) => (
                <td key={m} className="rounded bg-zinc-800/60 px-1 py-1 font-medium text-zinc-200">{fmt(r)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {hover && (hover.cell.proj || hover.cell.actual !== undefined || hover.cell.live !== undefined) && (
        <div
          className="pointer-events-none absolute z-10 w-max -translate-x-1/2 rounded border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 text-left text-xs shadow-lg"
          style={{ left: hover.x, top: hover.top + 6 }}
        >
          <div className="mb-0.5 font-semibold text-zinc-300">
            {MONTHS[hover.m]} {hover.y}
          </div>
          {hover.cell.actual !== undefined && (
            <div className="tabular-nums text-zinc-100">actual {fmt(hover.cell.actual)}</div>
          )}
          {hover.cell.live !== undefined && (
            <div className="tabular-nums text-sky-300">month-to-date {fmt(hover.cell.live)} · live</div>
          )}
          {hover.cell.proj && (
            <div className="mt-0.5 space-y-0.5 tabular-nums">
              {hover.cell.live !== undefined && (
                <div className="mb-0.5 text-[11px] text-zinc-500">full-month projection:</div>
              )}
              <div style={{ color: "#34d399" }}>bull {fmt(hover.cell.proj.bull)} → {fmtPrice(hover.cell.proj.bullPrice)}</div>
              <div style={{ color: "#fbbf24" }}>base {fmt(hover.cell.proj.base)} → {fmtPrice(hover.cell.proj.basePrice)}</div>
              <div style={{ color: "#f87171" }}>bear {fmt(hover.cell.proj.bear)} → {fmtPrice(hover.cell.proj.bearPrice)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
