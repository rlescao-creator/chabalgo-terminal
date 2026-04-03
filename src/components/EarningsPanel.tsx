"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface EarningsEntry {
  period: string;
  quarter: number | null;
  year: number | null;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprise_pct: number | null;
}

interface NextEarnings {
  date: string;
  days_until: number;
  hour: string;
  eps_estimate: number | null;
  revenue_estimate: number | null;
}

interface EarningsData {
  ticker: string;
  history: EarningsEntry[];
  next_earnings: NextEarnings | null;
}

function buildEarningsSummary(history: EarningsEntry[], nextEarnings: NextEarnings | null, ticker: string): string {
  if (!history.length) return "";
  const parts: string[] = [];

  const withActual = history.filter(e => e.actual != null && e.estimate != null);
  const beats = withActual.filter(e => e.actual! >= e.estimate!);
  const beatRate = withActual.length > 0 ? (beats.length / withActual.length * 100) : 0;

  if (beatRate >= 80) {
    parts.push(`${ticker} has beaten estimates in ${beats.length} of the last ${withActual.length} quarters (${beatRate.toFixed(0)}%) — a very consistent execution track record.`);
  } else if (beatRate >= 60) {
    parts.push(`${ticker} has beaten estimates in ${beats.length}/${withActual.length} quarters — generally solid but with occasional misses.`);
  } else {
    parts.push(`${ticker} has only beaten estimates ${beats.length}/${withActual.length} times recently — inconsistent execution is a concern.`);
  }

  // Recent trend
  if (withActual.length >= 2) {
    const latest = withActual[0];
    const prev = withActual[1];
    if (latest.surprise_pct != null && prev.surprise_pct != null) {
      if (latest.surprise_pct > prev.surprise_pct && latest.surprise_pct > 0) {
        parts.push(`The surprise margin is improving (+${latest.surprise_pct.toFixed(1)}% last quarter vs +${prev.surprise_pct.toFixed(1)}% before) — a positive trend.`);
      } else if (latest.surprise_pct < 0) {
        parts.push(`Last quarter was a miss (${latest.surprise_pct.toFixed(1)}% below estimates) — watch for whether this is a one-off or a trend.`);
      }
    }
    if (latest.actual != null && prev.actual != null && prev.actual > 0) {
      const epsGrowth = ((latest.actual - prev.actual) / Math.abs(prev.actual) * 100);
      if (epsGrowth > 20) {
        parts.push(`EPS grew ${epsGrowth.toFixed(0)}% quarter-over-quarter — strong earnings momentum.`);
      }
    }
  }

  if (nextEarnings) {
    if (nextEarnings.days_until <= 14) {
      parts.push(`Next earnings in ${nextEarnings.days_until} days — expect elevated volatility around the report.`);
    }
  }

  return parts.join(" ");
}

export default function EarningsPanel({ ticker }: { ticker: string }) {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/earnings/${ticker}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [ticker]);

  const chartData = (data?.history || [])
    .slice()
    .reverse()
    .map((e) => ({
      label: e.quarter && e.year ? `Q${e.quarter} ${e.year}` : e.period,
      actual: e.actual,
      estimate: e.estimate,
      surprise_pct: e.surprise_pct,
      beat: e.actual != null && e.estimate != null && e.actual >= e.estimate,
    }));

  const beatCount = chartData.filter((d) => d.beat).length;
  const totalCount = chartData.filter((d) => d.actual != null).length;

  return (
    <div className="bg-card border border-border p-5">
      <h3 className="text-accent text-xs font-semibold tracking-wider mb-4">EARNINGS</h3>

      {loading ? (
        <div className="text-accent text-xs animate-pulse">Loading earnings data...</div>
      ) : !data ? (
        <div className="text-muted text-sm">Data unavailable</div>
      ) : (
        <>
          {data.next_earnings ? (
            <div className="border border-border bg-subtle p-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted tracking-wider">NEXT EARNINGS</div>
                <div className="flex items-center gap-2">
                  <span className="text-accent text-sm font-semibold">
                    {data.next_earnings.days_until === 0
                      ? "TODAY"
                      : data.next_earnings.days_until === 1
                      ? "TOMORROW"
                      : `${data.next_earnings.days_until}d`}
                  </span>
                  <span className="text-muted text-xs">
                    {data.next_earnings.date}
                    {data.next_earnings.hour === "bmo"
                      ? " (Before Open)"
                      : data.next_earnings.hour === "amc"
                      ? " (After Close)"
                      : ""}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted mb-3">No upcoming earnings date available</div>
          )}

          {totalCount > 0 && (
            <div className="text-xs text-muted mb-3">
              BEAT RECORD: <span className="text-green font-semibold">{beatCount}/{totalCount}</span>
              {" "}({((beatCount / totalCount) * 100).toFixed(0)}%)
            </div>
          )}

          {chartData.length > 0 && (
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }} barGap={2}>
                  <XAxis dataKey="label" tick={{ fill: "#8B8680", fontSize: 10 }} axisLine={{ stroke: "#E5E0DA" }} tickLine={false} />
                  <YAxis tick={{ fill: "#8B8680", fontSize: 10 }} axisLine={{ stroke: "#E5E0DA" }} tickLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#FFFFFF", border: "1px solid #E5E0DA", fontSize: "11px", borderRadius: 2 }}
                    labelStyle={{ color: "#8B8680" }}
                    formatter={(value: number, name: string) => [
                      `$${value?.toFixed(4) ?? "--"}`,
                      name === "estimate" ? "Estimate" : "Actual",
                    ]}
                  />
                  <ReferenceLine y={0} stroke="#E5E0DA" />
                  <Bar dataKey="estimate" fill="#E5E0DA" radius={[2, 2, 0, 0]} barSize={16} />
                  <Bar dataKey="actual" radius={[2, 2, 0, 0]} barSize={16}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.beat ? "#F37021" : "#C0392B"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {chartData.length > 0 && (
            <div className="mt-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted border-b border-border">
                    <th className="text-left pb-1.5 font-normal">QTR</th>
                    <th className="text-right pb-1.5 font-normal">EST</th>
                    <th className="text-right pb-1.5 font-normal">ACT</th>
                    <th className="text-right pb-1.5 font-normal">SURPRISE</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((e, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1.5 text-muted">{e.label}</td>
                      <td className="py-1.5 text-right text-muted">{e.estimate != null ? `$${e.estimate.toFixed(2)}` : "--"}</td>
                      <td className={`py-1.5 text-right font-medium ${e.beat ? "text-green" : "text-red"}`}>
                        {e.actual != null ? `$${e.actual.toFixed(2)}` : "--"}
                      </td>
                      <td className={`py-1.5 text-right ${e.surprise_pct != null && e.surprise_pct >= 0 ? "text-green" : "text-red"}`}>
                        {e.surprise_pct != null ? `${e.surprise_pct >= 0 ? "+" : ""}${e.surprise_pct.toFixed(1)}%` : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary */}
          {data.history.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <p className="text-[11px] text-muted leading-relaxed">
                {buildEarningsSummary(data.history, data.next_earnings, ticker)}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
