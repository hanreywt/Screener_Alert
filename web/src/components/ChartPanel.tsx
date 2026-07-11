"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from "lightweight-charts";
import type { Analysis } from "@/lib/types";
import { zoneColor } from "@/lib/ui";

export default function ChartPanel({ data }: { data: Analysis }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  // create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontFamily: "ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "rgba(63,63,70,0.25)" },
        horzLines: { color: "rgba(63,63,70,0.25)" },
      },
      rightPriceScale: { borderColor: "rgba(63,63,70,0.5)" },
      timeScale: { borderColor: "rgba(63,63,70,0.5)", timeVisible: true },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // push data + zone lines on every update
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    series.setData(
      data.candles.map((c) => ({
        time: c.time as never,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    // refresh zone price lines
    for (const pl of linesRef.current) series.removePriceLine(pl);
    linesRef.current = [];
    const top = data.zones.filter((z) => z.strength >= 50).slice(0, 8);
    for (const z of top) {
      const pl = series.createPriceLine({
        price: z.price,
        color: zoneColor(z),
        lineWidth: z.strength >= 70 ? 2 : 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${z.strength.toFixed(0)}${z.tags.length ? " " + z.tags.join("/") : ""}`,
      });
      linesRef.current.push(pl);
    }

    // Previous day/week high-low. Drawn SOLID so they read as fixed reference
    // levels, distinct from the dashed, score-driven zones above. Amber = daily,
    // violet = weekly. Display only — these drive nothing.
    for (const lv of data.refLevels?.levels ?? []) {
      const weekly = lv.label.startsWith("PW");
      const pl = series.createPriceLine({
        price: lv.price,
        color: weekly ? "#a78bfa" : "#f59e0b",
        lineWidth: 1,
        lineStyle: 0, // solid
        axisLabelVisible: true,
        title: lv.label,
      });
      linesRef.current.push(pl);
    }
    chart.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="h-[440px] w-full" />;
}
