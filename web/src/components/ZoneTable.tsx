"use client";

import type { Analysis } from "@/lib/types";
import { fmt, strengthTone } from "@/lib/ui";

export default function ZoneTable({ data }: { data: Analysis }) {
  const zones = data.zones.filter((z) => z.strength >= 45).slice(0, 12);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3">Zone</th>
            <th className="pr-3">Type</th>
            <th className="pr-3">Strength</th>
            <th className="pr-3">Touches</th>
            <th className="pr-3">Confluence</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr
              key={z.price}
              className="border-b border-zinc-900 hover:bg-zinc-900/40"
            >
              <td className="py-2 pr-3 font-mono">{fmt(z.price)}</td>
              <td className="pr-3">
                <span
                  className={
                    z.kind === "support"
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {z.kind}
                </span>
              </td>
              <td className="pr-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${
                        z.strength >= 70
                          ? "bg-emerald-400"
                          : z.strength >= 55
                            ? "bg-lime-400"
                            : "bg-amber-400"
                      }`}
                      style={{ width: `${z.strength}%` }}
                    />
                  </div>
                  <span className={`font-mono text-xs ${strengthTone(z.strength)}`}>
                    {z.strength.toFixed(0)}
                  </span>
                </div>
              </td>
              <td className="pr-3 font-mono text-zinc-400">{z.touches}</td>
              <td className="pr-3">
                <div className="flex flex-wrap gap-1">
                  {z.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
