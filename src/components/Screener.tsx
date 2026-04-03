"use client";

import { useEffect, useState, useCallback, Fragment } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Metrics {
  rd_ratio: number | null;
  revenue_growth: number | null;
  rule_of_40: number | null;
  magic_number: number | null;
  fcf_margin: number | null;
  gross_margin: number | null;
  op_margin: number | null;
  insider_pct: number | null;
  institutional_pct: number | null;
  pe: number | null;
  forward_pe: number | null;
  sga_trend: number[] | null;
  sga_improving: boolean;
  cash_runway_quarters: number | null;
  total_cash_b: number | null;
}

interface ScreenerResult {
  ticker: string;
  name: string;
  sector: string;
  price: number | null;
  change_pct: number | null;
  currency: string;
  market_cap_b: number;
  score: number;
  verdict: string;
  flags: string[];
  metrics: Metrics;
}

interface ScreenerData {
  results: ScreenerResult[];
  last_computed: string | null;
  computing: boolean;
  universe_size: number;
  sectors: string[];
}

interface ScreenerProps {
  onSelectTicker: (ticker: string) => void;
}

export default function Screener({ onSelectTicker }: ScreenerProps) {
  const [data, setData] = useState<ScreenerData | null>(null);
  const [computing, setComputing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/screener`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (d.computing) setComputing(true);
        else setComputing(false);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchResults();
    const interval = setInterval(fetchResults, 15000);
    return () => clearInterval(interval);
  }, [fetchResults]);

  const handleRun = async () => {
    setComputing(true);
    try {
      await fetch(`${API_BASE}/screener/run`, { method: "POST" });
    } catch {
      // silent
    }
    // Poll
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/screener`);
        if (res.ok) {
          const d = await res.json();
          setData(d);
          if (!d.computing) {
            clearInterval(poll);
            setComputing(false);
          }
        }
      } catch {
        // silent
      }
    }, 5000);
  };

  const scoreColor = (score: number) => {
    if (score >= 75) return "text-green";
    if (score >= 60) return "text-accent";
    if (score >= 45) return "text-yellow";
    return "text-muted";
  };

  const scoreBg = (score: number) => {
    if (score >= 75) return "bg-green/10 border-green/30";
    if (score >= 60) return "bg-accent/10 border-accent/30";
    if (score >= 45) return "bg-yellow/10 border-yellow/30";
    return "bg-muted/10 border-muted/30";
  };

  const metricColor = (val: number | null, good: number, great: number) => {
    if (val == null) return "text-muted";
    if (val >= great) return "text-green";
    if (val >= good) return "text-accent";
    return "text-foreground";
  };

  const currSym = (c: string) => (c === "EUR" ? "€" : c === "GBP" ? "£" : "$");

  const formatTime = (iso: string | null) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const filtered = data?.results?.filter(
    (r) => sectorFilter === "all" || r.sector === sectorFilter
  ) || [];
  const visible = showAll ? filtered : filtered.slice(0, 15);

  const passR40 = filtered.filter((r) => (r.metrics.rule_of_40 ?? 0) >= 40).length;
  const passRD = filtered.filter((r) => (r.metrics.rd_ratio ?? 0) >= 18).length;
  const passMagic = filtered.filter((r) => (r.metrics.magic_number ?? 0) >= 0.75).length;
  const strongCompounders = filtered.filter((r) => r.score >= 75).length;

  return (
    <div className="border border-border bg-card">
      {/* Action bar */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <p className="text-[10px] text-muted">
          Mid-cap compounders with high-optionality traits (R&D intensity,
          Rule of 40, operating leverage, insider alignment)
        </p>
        <button
          onClick={handleRun}
          disabled={computing}
          className={`text-[10px] px-3 py-1 border transition-colors tracking-wider shrink-0 ml-3 ${
            computing
              ? "border-border text-muted cursor-not-allowed"
              : "border-accent text-accent hover:bg-accent/5"
          }`}
        >
          {computing ? "SCREENING..." : "RUN SCREENER"}
        </button>
      </div>

      {/* Stats bar */}
      {data && data.results.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-subtle/30 text-[10px]">
          <span className="text-muted">
            {data.universe_size} stocks screened
            {data.last_computed ? ` at ${formatTime(data.last_computed)}` : ""}
          </span>
          <span className="text-green">{strongCompounders} strong compounders</span>
          <span className="text-accent">{passR40} pass Rule of 40</span>
          <span className="text-foreground">{passRD} high R&D</span>
          <span className="text-foreground">{passMagic} efficient (MN≥0.75)</span>
        </div>
      )}

      {/* Sector filter */}
      {data && data.sectors && data.sectors.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-border">
          <button
            onClick={() => setSectorFilter("all")}
            className={`text-[9px] px-2 py-0.5 border transition-colors tracking-wider ${
              sectorFilter === "all"
                ? "border-accent text-accent bg-accent/5"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            ALL
          </button>
          {data.sectors.map((s) => (
            <button
              key={s}
              onClick={() => setSectorFilter(s)}
              className={`text-[9px] px-2 py-0.5 border transition-colors tracking-wider ${
                sectorFilter === s
                  ? "border-accent text-accent bg-accent/5"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {computing && (!data || data.results.length === 0) ? (
        <div className="p-8 text-center">
          <div className="text-accent text-sm animate-pulse mb-2">
            Running institutional screener...
          </div>
          <div className="text-muted text-xs">
            Analyzing {data?.universe_size || 80}+ stocks across 8 sectors.
            <br />Deep financial analysis per stock — this takes 3-5 minutes.
          </div>
        </div>
      ) : !data || data.results.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-muted text-sm mb-3">
            No screener results yet.
          </div>
          <button
            onClick={handleRun}
            className="text-accent text-xs border border-accent px-4 py-1.5 hover:bg-accent/5 tracking-wider"
          >
            RUN FIRST SCREEN
          </button>
        </div>
      ) : (
        <div>
          {/* Results table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-muted border-b border-border">
                  <th className="text-left px-3 py-2 font-normal">#</th>
                  <th className="text-left py-2 font-normal">STOCK</th>
                  <th className="text-left py-2 font-normal">SECTOR</th>
                  <th className="text-right py-2 pr-2 font-normal">MCAP</th>
                  <th className="text-right py-2 pr-2 font-normal">R&D/REV</th>
                  <th className="text-right py-2 pr-2 font-normal">RULE 40</th>
                  <th className="text-right py-2 pr-2 font-normal">MAGIC#</th>
                  <th className="text-right py-2 pr-2 font-normal">INSIDER%</th>
                  <th className="text-right py-2 pr-2 font-normal">SCORE</th>
                  <th className="text-left py-2 pl-2 font-normal">VERDICT</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((stock, i) => (
                  <Fragment key={stock.ticker}>
                    <tr
                      className={`border-b border-border/50 hover:bg-accent/5 cursor-pointer transition-colors ${
                        expanded === stock.ticker ? "bg-accent/5" : ""
                      }`}
                      onClick={() =>
                        setExpanded(expanded === stock.ticker ? null : stock.ticker)
                      }
                    >
                      <td className="px-3 py-2 text-muted/50">{i + 1}</td>
                      <td className="py-2">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-accent font-semibold cursor-pointer hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectTicker(stock.ticker);
                              }}
                            >
                              {stock.ticker}
                            </span>
                            {stock.change_pct != null && (
                              <span
                                className={`text-[9px] ${
                                  stock.change_pct >= 0 ? "text-green" : "text-red"
                                }`}
                              >
                                {stock.change_pct >= 0 ? "+" : ""}
                                {stock.change_pct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <span className="text-muted text-[10px] truncate max-w-[140px]">
                            {stock.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2">
                        <span className="text-[9px] text-muted tracking-wider">
                          {stock.sector.length > 16
                            ? stock.sector.slice(0, 14) + "…"
                            : stock.sector}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-right text-foreground">
                        ${stock.market_cap_b.toFixed(1)}B
                      </td>
                      <td
                        className={`py-2 pr-2 text-right font-medium ${metricColor(
                          stock.metrics.rd_ratio,
                          12,
                          18
                        )}`}
                      >
                        {stock.metrics.rd_ratio != null
                          ? `${stock.metrics.rd_ratio}%`
                          : "--"}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right font-medium ${metricColor(
                          stock.metrics.rule_of_40,
                          25,
                          40
                        )}`}
                      >
                        {stock.metrics.rule_of_40 != null
                          ? stock.metrics.rule_of_40.toFixed(0)
                          : "--"}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right font-medium ${metricColor(
                          stock.metrics.magic_number,
                          0.5,
                          0.75
                        )}`}
                      >
                        {stock.metrics.magic_number != null
                          ? stock.metrics.magic_number.toFixed(2)
                          : "--"}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right ${metricColor(
                          stock.metrics.insider_pct,
                          5,
                          10
                        )}`}
                      >
                        {stock.metrics.insider_pct != null
                          ? `${stock.metrics.insider_pct}%`
                          : "--"}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right font-bold text-sm ${scoreColor(
                          stock.score
                        )}`}
                      >
                        {stock.score}
                      </td>
                      <td className="py-2 pl-2">
                        <span
                          className={`text-[9px] tracking-wider px-1.5 py-0.5 border ${scoreBg(
                            stock.score
                          )} ${scoreColor(stock.score)}`}
                        >
                          {stock.verdict}
                        </span>
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    {expanded === stock.ticker && (
                      <tr className="bg-subtle/30">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                            <div>
                              <div className="text-[9px] text-muted tracking-wider mb-1">
                                FINANCIALS
                              </div>
                              <div className="space-y-0.5 text-[11px]">
                                <div>
                                  Gross Margin:{" "}
                                  <span
                                    className={metricColor(
                                      stock.metrics.gross_margin,
                                      50,
                                      70
                                    )}
                                  >
                                    {stock.metrics.gross_margin ?? "--"}%
                                  </span>
                                </div>
                                <div>
                                  Op Margin:{" "}
                                  <span className="text-foreground">
                                    {stock.metrics.op_margin ?? "--"}%
                                  </span>
                                </div>
                                <div>
                                  FCF Margin:{" "}
                                  <span
                                    className={metricColor(
                                      stock.metrics.fcf_margin,
                                      5,
                                      15
                                    )}
                                  >
                                    {stock.metrics.fcf_margin ?? "--"}%
                                  </span>
                                </div>
                                <div>
                                  Cash: ${stock.metrics.total_cash_b ?? "--"}B
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-muted tracking-wider mb-1">
                                VALUATION
                              </div>
                              <div className="space-y-0.5 text-[11px]">
                                <div>
                                  P/E: {stock.metrics.pe ?? "--"}x
                                </div>
                                <div>
                                  Fwd P/E: {stock.metrics.forward_pe ?? "--"}x
                                </div>
                                <div>
                                  Rev Growth:{" "}
                                  <span
                                    className={metricColor(
                                      stock.metrics.revenue_growth,
                                      15,
                                      30
                                    )}
                                  >
                                    {stock.metrics.revenue_growth != null
                                      ? `+${stock.metrics.revenue_growth}%`
                                      : "--"}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-muted tracking-wider mb-1">
                                OWNERSHIP & LEVERAGE
                              </div>
                              <div className="space-y-0.5 text-[11px]">
                                <div>
                                  Insiders: {stock.metrics.insider_pct ?? "--"}%
                                </div>
                                <div>
                                  Institutions:{" "}
                                  {stock.metrics.institutional_pct ?? "--"}%
                                </div>
                                <div>
                                  SG&A Improving:{" "}
                                  <span
                                    className={
                                      stock.metrics.sga_improving
                                        ? "text-green"
                                        : "text-muted"
                                    }
                                  >
                                    {stock.metrics.sga_improving ? "YES" : "NO"}
                                  </span>
                                </div>
                                {stock.metrics.sga_trend && (
                                  <div className="text-muted text-[9px]">
                                    SG&A%: {stock.metrics.sga_trend.join("% → ")}%
                                  </div>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-muted tracking-wider mb-1">
                                SURVIVAL & RUNWAY
                              </div>
                              <div className="space-y-0.5 text-[11px]">
                                <div>
                                  Cash Runway:{" "}
                                  <span
                                    className={
                                      stock.metrics.cash_runway_quarters === 999
                                        ? "text-green"
                                        : stock.metrics.cash_runway_quarters &&
                                          stock.metrics.cash_runway_quarters >= 8
                                        ? "text-foreground"
                                        : "text-red"
                                    }
                                  >
                                    {stock.metrics.cash_runway_quarters === 999
                                      ? "Self-funding"
                                      : stock.metrics.cash_runway_quarters != null
                                      ? `${stock.metrics.cash_runway_quarters} quarters`
                                      : "--"}
                                  </span>
                                </div>
                                <div>
                                  Price: {currSym(stock.currency)}
                                  {stock.price?.toFixed(2) ?? "--"}
                                </div>
                              </div>
                            </div>
                          </div>
                          {stock.flags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {stock.flags.map((f, fi) => (
                                <span
                                  key={fi}
                                  className="text-[9px] px-2 py-0.5 bg-accent/10 border border-accent/20 text-accent tracking-wider"
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 15 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="w-full py-2 text-[10px] text-accent hover:bg-accent/5 border-t border-border tracking-wider"
            >
              {showAll ? "SHOW TOP 15" : `SHOW ALL ${filtered.length} RESULTS`}
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border bg-subtle/30">
        <div className="text-[9px] text-muted">
          Methodology: R&D Intensity (20%) + Rule of 40 (20%) + Magic Number (15%)
          + Revenue Growth (15%) + Gross Margins (10%) + Operating Leverage (10%)
          + Insider Alignment (10%) | Source: SEC 10-K, yfinance
        </div>
      </div>
    </div>
  );
}
