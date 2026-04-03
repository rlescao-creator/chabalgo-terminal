"use client";

import { useEffect, useState, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface RankedStock {
  ticker: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  currency: string;
  long_term_score: number | null;
  long_term_verdict: string;
  short_term_score: number | null;
  short_term_verdict: string;
  pe_ratio: number | null;
  revenue_growth: number | null;
  rsi: number | null;
}

interface RankingsData {
  long_term: RankedStock[];
  short_term: RankedStock[];
  last_updated: string | null;
  computing: boolean;
  universe_size: number;
}

interface RankingsProps {
  onSelectTicker: (ticker: string) => void;
}

export default function Rankings({ onSelectTicker }: RankingsProps) {
  const [data, setData] = useState<RankingsData | null>(null);
  const [tab, setTab] = useState<"long" | "short">("long");
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRankings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/rankings`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchRankings();
    const interval = setInterval(fetchRankings, 30000);
    return () => clearInterval(interval);
  }, [fetchRankings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_BASE}/rankings/refresh`, { method: "POST" });
    } catch {
      // silent
    }
    // Poll for completion
    const poll = setInterval(async () => {
      const res = await fetch(`${API_BASE}/rankings`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (!d.computing) {
          clearInterval(poll);
          setRefreshing(false);
        }
      }
    }, 5000);
  };

  const stocks = tab === "long" ? data?.long_term : data?.short_term;
  const isComputing = data?.computing || refreshing;
  const hasData = stocks && stocks.length > 0;

  const scoreColor = (score: number | null) => {
    if (score == null) return "text-muted";
    if (score >= 70) return "text-green";
    if (score >= 55) return "text-green/70";
    if (score >= 45) return "text-yellow";
    return "text-red";
  };

  const currencySymbol = (c: string) => {
    if (c === "EUR") return "€";
    if (c === "GBP") return "£";
    if (c === "CHF") return "CHF ";
    return "$";
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-4 py-2.5 border transition-all text-sm ${
          open
            ? "border-accent bg-accent/5 text-accent"
            : "border-border text-muted hover:text-foreground hover:border-accent/40"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4h18M3 8h12M3 12h18M3 16h8M3 20h14" />
        </svg>
        <span className="tracking-wider">TOP PICKS</span>
        {isComputing && (
          <span className="w-2 h-2 bg-accent rounded-full animate-pulse" />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-[520px] bg-card border border-border shadow-xl max-h-[70vh] overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setTab("long")}
              className={`flex-1 px-4 py-2.5 text-xs tracking-wider transition-colors ${
                tab === "long"
                  ? "text-accent border-b-2 border-accent bg-accent/5 font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              LONG-TERM TOP 15
            </button>
            <button
              onClick={() => setTab("short")}
              className={`flex-1 px-4 py-2.5 text-xs tracking-wider transition-colors ${
                tab === "short"
                  ? "border-b-2 font-semibold bg-opacity-5"
                  : "text-muted hover:text-foreground"
              }`}
              style={tab === "short" ? { color: "#2D8B4E", borderColor: "#2D8B4E", backgroundColor: "rgba(45,139,78,0.05)" } : {}}
            >
              SHORT-TERM TOP 15
            </button>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-subtle/50">
            <div className="text-[10px] text-muted">
              {data?.last_updated
                ? `Updated ${formatTime(data.last_updated)}`
                : "Not yet computed"}
              {data?.universe_size ? ` | ${data.universe_size} stocks scanned` : ""}
            </div>
            <button
              onClick={handleRefresh}
              disabled={isComputing}
              className={`text-[10px] px-2 py-0.5 border border-border transition-colors ${
                isComputing
                  ? "text-muted cursor-not-allowed"
                  : "text-accent hover:bg-accent/5"
              }`}
            >
              {isComputing ? "COMPUTING..." : "REFRESH"}
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1">
            {isComputing && !hasData ? (
              <div className="p-6 text-center">
                <div className="text-accent text-sm animate-pulse mb-2">Computing scores...</div>
                <div className="text-muted text-xs">
                  Analyzing {data?.universe_size || 0} stocks across US & EU markets.
                  <br />This takes 2-3 minutes on first load.
                </div>
              </div>
            ) : !hasData ? (
              <div className="p-6 text-center text-muted text-sm">
                No rankings available yet.
                <button onClick={handleRefresh} className="text-accent ml-1 hover:underline">
                  Compute now
                </button>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-muted border-b border-border">
                    <th className="text-left px-3 py-2 font-normal w-5">#</th>
                    <th className="text-left py-2 font-normal">STOCK</th>
                    <th className="text-right py-2 pr-2 font-normal">PRICE</th>
                    <th className="text-right py-2 pr-2 font-normal">CHG</th>
                    <th className="text-right py-2 pr-2 font-normal">
                      {tab === "long" ? "LT" : "ST"} SCORE
                    </th>
                    <th className="text-left py-2 pl-2 font-normal">VERDICT</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks?.map((stock, i) => {
                    const score = tab === "long" ? stock.long_term_score : stock.short_term_score;
                    const verdict_text = tab === "long" ? stock.long_term_verdict : stock.short_term_verdict;
                    return (
                      <tr
                        key={stock.ticker}
                        className="border-b border-border/50 hover:bg-accent/5 cursor-pointer transition-colors"
                        onClick={() => {
                          onSelectTicker(stock.ticker);
                          setOpen(false);
                        }}
                      >
                        <td className="px-3 py-2 text-muted/50">{i + 1}</td>
                        <td className="py-2">
                          <div className="flex flex-col">
                            <span className="text-accent font-semibold">{stock.ticker}</span>
                            <span className="text-muted text-[10px] truncate max-w-[160px]">{stock.name}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-2 text-right text-foreground">
                          {stock.price != null
                            ? `${currencySymbol(stock.currency)}${stock.price.toFixed(2)}`
                            : "--"}
                        </td>
                        <td className={`py-2 pr-2 text-right ${
                          stock.change_pct != null
                            ? stock.change_pct >= 0 ? "text-green" : "text-red"
                            : "text-muted"
                        }`}>
                          {stock.change_pct != null
                            ? `${stock.change_pct >= 0 ? "+" : ""}${stock.change_pct.toFixed(1)}%`
                            : "--"}
                        </td>
                        <td className={`py-2 pr-2 text-right font-semibold text-sm ${scoreColor(score)}`}>
                          {score ?? "--"}
                        </td>
                        <td className="py-2 pl-2">
                          <span className={`text-[10px] tracking-wider ${scoreColor(score)}`}>
                            {verdict_text || "--"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
