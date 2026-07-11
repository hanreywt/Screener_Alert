"use client";

import type { Analysis } from "@/lib/types";
import { fmt } from "@/lib/ui";

/**
 * Previous day / previous week high-low, with where price sits relative to each.
 *
 * Reference levels for the eye, not inputs to any signal — they're where resting
 * stops and breakout orders cluster, so "which side of PDH am I on" frames the
 * area you're trading in. Nothing here feeds zones, alerts, or the journal.
 */
export default function KeyLevels({ data }: { data: Analysis }) {
  const levels = data.refLevels?.levels ?? [];
  if (!levels.length) return null;

  const range = data.refLevels.dayRange;
  const price = data.price;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-300">
          Key levels{" "}
          <span className="font-normal text-zinc-500">(prev day / week · UTC)</span>
        </h2>
        {range && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              range.insideRange
                ? "bg-zinc-800 text-zinc-400"
                : "bg-amber-950/60 text-amber-400"
            }`}
          >
            {range.insideRange
              ? "inside prev-day range"
              : price > range.high
                ? "above prev-day range"
                : "below prev-day range"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {levels.map((lv) => {
          const deltaPct = ((price - lv.price) / lv.price) * 100;
          const above = price >= lv.price;
          const weekly = lv.label.startsWith("PW");
          return (
            <div
              key={lv.label}
              className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-2"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: weekly ? "#a78bfa" : "#f59e0b" }}
                />
                <span className="text-xs font-medium text-zinc-300">{lv.label}</span>
                <span className="text-[10px] text-zinc-600">{lv.name}</span>
              </div>
              <div className="mt-1 font-mono text-sm text-zinc-100">
                {fmt(lv.price)}
              </div>
              <div
                className={`text-[11px] ${above ? "text-emerald-400/80" : "text-red-400/80"}`}
              >
                price {above ? "above" : "below"} · {deltaPct >= 0 ? "+" : ""}
                {deltaPct.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
