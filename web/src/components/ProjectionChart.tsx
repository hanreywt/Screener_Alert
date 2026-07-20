"use client";

import { useMemo, useState } from "react";
import type { Bands, MonthPoint } from "@/lib/projection";

/**
 * BTC monthly history since 2013 → forward scenario cone, as a log-scale SVG.
 * lightweight-charts is candle/line oriented; a shaded percentile band between
 * two arbitrary curves plus overlaid scenario lines is far cleaner drawn
 * directly (same approach as the journal's EquityChart). Log y is essential —
 * the series spans ~$20 (2013) to six figures.
 */

const W = 960;
const H = 420;
const PAD = { l: 60, r: 16, t: 16, b: 30 };

const COL = {
  history: "#38bdf8", // sky
  band: "#818cf8", // indigo (fan fill + p50)
  bull: "#34d399", // emerald
  base: "#fbbf24", // amber
  bear: "#f87171", // red
  grid: "#3f3f46",
  now: "#a1a1aa",
};

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  if (v >= 1) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

const monthLabel = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** 1–2–5 decade ticks within [lo, hi], for a log price axis. */
function logTicks(lo: number, hi: number): number[] {
  const ticks: number[] = [];
  let decade = Math.pow(10, Math.floor(Math.log10(lo)));
  while (decade <= hi) {
    for (const m of [1, 2, 5]) {
      const v = decade * m;
      if (v >= lo && v <= hi) ticks.push(v);
    }
    decade *= 10;
  }
  return ticks;
}

export default function ProjectionChart({
  history,
  bands,
  spot,
}: {
  history: MonthPoint[];
  bands: Bands;
  spot: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const hist = history;
    const fan = bands.fan;
    const Hn = hist.length; // history columns
    const spotIdx = Hn - 1; // the cone emanates from here (latest close)
    const N = Hn + fan.length; // total columns (history + future)

    // Combined timeline (for axis labels + hover).
    const times = [...hist.map((h) => h.time), ...fan.map((f) => f.time)];

    // y-domain across everything we draw, then a touch of log-space padding.
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of hist) {
      lo = Math.min(lo, h.close);
      hi = Math.max(hi, h.close);
    }
    for (const f of fan) {
      lo = Math.min(lo, f.p10);
      hi = Math.max(hi, f.p90);
    }
    hi = Math.max(hi, bands.end.bull);
    lo = Math.min(lo, bands.end.bear);
    const lg0 = Math.log10(lo) - 0.04;
    const lg1 = Math.log10(hi) + 0.04;

    const x = (i: number) => PAD.l + (i / (N - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) =>
      PAD.t + (1 - (Math.log10(v) - lg0) / (lg1 - lg0)) * (H - PAD.t - PAD.b);

    const histLine = hist
      .map((h, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(h.close).toFixed(1)}`)
      .join(" ");

    // Fan polygon: from spot along p90, back along p10 — a cone that opens right.
    const top = [`M${x(spotIdx).toFixed(1)},${y(spot).toFixed(1)}`];
    for (let m = 0; m < fan.length; m++)
      top.push(`L${x(Hn + m).toFixed(1)},${y(fan[m].p90).toFixed(1)}`);
    for (let m = fan.length - 1; m >= 0; m--)
      top.push(`L${x(Hn + m).toFixed(1)},${y(fan[m].p10).toFixed(1)}`);
    top.push("Z");
    const bandPath = top.join(" ");

    const coneLine = (
      pick: (m: number) => number,
    ): string => {
      let d = `M${x(spotIdx).toFixed(1)},${y(spot).toFixed(1)}`;
      for (let m = 0; m < fan.length; m++)
        d += ` L${x(Hn + m).toFixed(1)},${y(pick(m)).toFixed(1)}`;
      return d;
    };
    const p50Line = coneLine((m) => fan[m].p50);
    const bullLine = coneLine((m) => bands.bull[m].value);
    const baseLine = coneLine((m) => bands.base[m].value);
    const bearLine = coneLine((m) => bands.bear[m].value);

    // Year gridlines for historical context.
    const yearMarks: { i: number; label: string }[] = [];
    let prevYear = -1;
    times.forEach((t, i) => {
      const yr = new Date(t * 1000).getUTCFullYear();
      if (yr !== prevYear) {
        yearMarks.push({ i, label: String(yr) });
        prevYear = yr;
      }
    });

    return {
      Hn,
      spotIdx,
      N,
      times,
      x,
      y,
      histLine,
      bandPath,
      p50Line,
      bullLine,
      baseLine,
      bearLine,
      yTicks: logTicks(lo, hi),
      yearMarks,
      nowX: x(spotIdx),
    };
  }, [history, bands, spot]);

  const hoverInfo = useMemo(() => {
    if (hover == null) return null;
    const t = geo.times[hover];
    if (hover < geo.Hn) {
      return { future: false as const, time: t, close: history[hover].close };
    }
    const m = hover - geo.Hn;
    const f = bands.fan[m];
    return {
      future: true as const,
      time: t,
      p10: f.p10,
      p50: f.p50,
      p90: f.p90,
      bull: bands.bull[m].value,
      bear: bands.bear[m].value,
    };
  }, [hover, geo, bands, history]);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(
            ((px - PAD.l) / (W - PAD.l - PAD.r)) * (geo.N - 1),
          );
          setHover(Math.max(0, Math.min(geo.N - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="fanfill" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={COL.band} stopOpacity="0.28" />
            <stop offset="100%" stopColor={COL.band} stopOpacity="0.12" />
          </linearGradient>
        </defs>

        {/* y gridlines + price labels (log) */}
        {geo.yTicks.map((v) => (
          <g key={`y${v}`}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={geo.y(v)}
              y2={geo.y(v)}
              stroke={COL.grid}
              strokeOpacity="0.3"
              strokeWidth="1"
            />
            <text x={PAD.l - 6} y={geo.y(v) + 3} fill="#71717a" fontSize="10" textAnchor="end">
              {fmtPrice(v)}
            </text>
          </g>
        ))}

        {/* year gridlines */}
        {geo.yearMarks.map((ym) => (
          <g key={`yr${ym.label}`}>
            <line
              x1={geo.x(ym.i)}
              x2={geo.x(ym.i)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke={COL.grid}
              strokeOpacity="0.18"
              strokeWidth="1"
            />
            <text x={geo.x(ym.i)} y={H - PAD.b + 14} fill="#71717a" fontSize="10" textAnchor="middle">
              {ym.label}
            </text>
          </g>
        ))}

        {/* fan cone */}
        <path d={geo.bandPath} fill="url(#fanfill)" stroke="none" />

        {/* scenario lines (drawn under history so history reads on top at the join) */}
        <path d={geo.bearLine} fill="none" stroke={COL.bear} strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={geo.baseLine} fill="none" stroke={COL.base} strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={geo.bullLine} fill="none" stroke={COL.bull} strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={geo.p50Line} fill="none" stroke={COL.band} strokeWidth="2" vectorEffect="non-scaling-stroke" />

        {/* history */}
        <path d={geo.histLine} fill="none" stroke={COL.history} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />

        {/* "now" divider */}
        <line
          x1={geo.nowX}
          x2={geo.nowX}
          y1={PAD.t}
          y2={H - PAD.b}
          stroke={COL.now}
          strokeOpacity="0.6"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {/* hover guide */}
        {hover != null && (
          <line
            x1={geo.x(hover)}
            x2={geo.x(hover)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="#a1a1aa"
            strokeOpacity="0.5"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* hover tooltip */}
      {hoverInfo && (
        <div
          className="pointer-events-none absolute top-1 rounded border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 text-xs shadow-lg"
          style={{
            left: `${(geo.x(hover!) / W) * 100}%`,
            transform: `translateX(${hover! > geo.N / 2 ? "-105%" : "5%"})`,
          }}
        >
          <div className="mb-0.5 font-semibold text-zinc-300">{monthLabel(hoverInfo.time)}</div>
          {hoverInfo.future ? (
            <div className="space-y-0.5 tabular-nums">
              <div style={{ color: COL.bull }}>bull {fmtPrice(hoverInfo.bull)}</div>
              <div style={{ color: COL.band }}>p90 {fmtPrice(hoverInfo.p90)}</div>
              <div className="text-zinc-200">median {fmtPrice(hoverInfo.p50)}</div>
              <div style={{ color: COL.band }}>p10 {fmtPrice(hoverInfo.p10)}</div>
              <div style={{ color: COL.bear }}>bear {fmtPrice(hoverInfo.bear)}</div>
            </div>
          ) : (
            <div className="tabular-nums text-zinc-100">{fmtPrice(hoverInfo.close)}</div>
          )}
        </div>
      )}
    </div>
  );
}
