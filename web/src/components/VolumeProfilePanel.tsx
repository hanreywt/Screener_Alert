"use client";

import type { Analysis } from "@/lib/types";
import { fmt } from "@/lib/ui";

/** Horizontal volume-profile histogram, high price at top. */
export default function VolumeProfilePanel({ data }: { data: Analysis }) {
  const { profile, price } = data;
  const vmax = Math.max(...profile.volume) || 1;
  // top -> bottom = high -> low price
  const rows = profile.prices
    .map((p, i) => ({ p, v: profile.volume[i] }))
    .reverse();

  const nearest = (target: number) =>
    profile.prices.reduce(
      (best, p, i) =>
        Math.abs(p - target) < Math.abs(profile.prices[best] - target) ? i : best,
      0,
    );
  const pocI = nearest(profile.poc);
  const vahI = nearest(profile.vah);
  const valI = nearest(profile.val);

  return (
    <div className="flex flex-col gap-[1px] text-[10px]">
      <div className="mb-1 flex justify-between text-xs text-zinc-400">
        <span>Volume Profile</span>
        <span>
          POC <span className="text-amber-400">{fmt(profile.poc)}</span>
        </span>
      </div>
      {rows.map(({ p, v }, ri) => {
        const i = profile.prices.length - 1 - ri;
        const w = (v / vmax) * 100;
        const isPoc = i === pocI;
        const inVA = i <= vahI && i >= valI;
        const nearPrice = Math.abs(p - price) < (profile.prices[1] - profile.prices[0]);
        return (
          <div key={i} className="flex items-center gap-1">
            <div className="relative h-[3px] flex-1 rounded-sm bg-zinc-800/40">
              <div
                className={`absolute left-0 top-0 h-full rounded-sm ${
                  isPoc
                    ? "bg-amber-400"
                    : inVA
                      ? "bg-sky-500/70"
                      : "bg-zinc-500/50"
                }`}
                style={{ width: `${w}%` }}
              />
              {nearPrice && (
                <div className="absolute right-0 top-1/2 h-[7px] w-[2px] -translate-y-1/2 bg-white" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
