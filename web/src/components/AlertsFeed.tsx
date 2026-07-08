"use client";

import type { Signal } from "@/lib/types";
import { fmt } from "@/lib/ui";

const ICON: Record<string, string> = {
  watch: "👀",
  break: "💥",
  retest: "🎯",
};

const BORDER: Record<string, string> = {
  watch: "border-l-amber-400",
  break: "border-l-fuchsia-400",
  retest: "border-l-emerald-400",
};

export default function AlertsFeed({ signals }: { signals: Signal[] }) {
  if (!signals.length) {
    return (
      <p className="text-sm text-zinc-500">
        No active setups. Zones are being watched — alerts fire when price
        approaches a strong zone, breaks it, or retests a flipped level.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {signals.map((s, i) => (
        <div
          key={`${s.symbol}-${s.kind}-${s.zonePrice}-${i}`}
          className={`rounded-md border border-zinc-800 border-l-2 ${BORDER[s.kind]} bg-zinc-900/50 p-3`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {ICON[s.kind]} {s.symbol}{" "}
              <span className="uppercase text-zinc-400">{s.kind}</span>
            </span>
            {s.breakRating != null && (
              <span className="font-mono text-xs text-fuchsia-300">
                break {s.breakRating.toFixed(0)}/100
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-300">{s.detail}</p>
          {s.kind === "retest" && (
            <div className="mt-2 space-y-1 rounded bg-black/30 p-2 font-mono text-xs">
              <div className="flex gap-4">
                <span>
                  Entry <span className="text-sky-300">{fmt(s.entry!)}</span>
                </span>
                <span>
                  Stop <span className="text-red-300">{fmt(s.stop!)}</span>
                </span>
                <span>
                  Target <span className="text-emerald-300">{fmt(s.target!)}</span>
                </span>
                <span>
                  R:R{" "}
                  <span
                    className={s.rr! >= 1.5 ? "text-emerald-300" : "text-amber-300"}
                  >
                    {s.rr}
                  </span>
                </span>
              </div>
              <p className="text-[10px] text-zinc-500">{s.winrateNote}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
