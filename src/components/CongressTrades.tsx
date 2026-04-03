"use client";

import { useEffect, useState, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Trade {
  politician: string;
  chamber: string;
  ticker: string;
  asset: string;
  type: string;
  amount: string;
  transaction_date: string;
  disclosure_date: string;
  owner: string;
}

interface TopBought {
  ticker: string;
  purchase_count: number;
  unique_politicians: number;
  politicians: string[];
  latest_date: string;
}

interface CongressTradesProps {
  ticker?: string;
  onSelectTicker?: (ticker: string) => void;
}

export default function CongressTrades({ ticker, onSelectTicker }: CongressTradesProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [topBought, setTopBought] = useState<TopBought[]>([]);
  const [tab, setTab] = useState<"trades" | "top">(ticker ? "trades" : "top");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState({ total: 0, purchases: 0, sales: 0 });

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const url = ticker
        ? `${API_BASE}/congress-trades?ticker=${ticker}`
        : `${API_BASE}/congress-trades`;
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        setTrades(d.trades || []);
        setStats({ total: d.total, purchases: d.purchases, sales: d.sales });
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, [ticker]);

  const fetchTopBought = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/congress-trades/top-bought`);
      if (res.ok) {
        const d = await res.json();
        setTopBought(d.top_bought || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchTrades();
    fetchTopBought();
  }, [fetchTrades, fetchTopBought]);

  const formatDate = (d: string) => {
    if (!d) return "--";
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
    } catch {
      return d;
    }
  };

  const daysAgo = (d: string) => {
    if (!d) return "";
    try {
      const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
      if (diff === 0) return "today";
      if (diff === 1) return "1d ago";
      return `${diff}d ago`;
    } catch {
      return "";
    }
  };

  const typeColor = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("purchase")) return "text-green";
    if (t.includes("sale")) return "text-red";
    return "text-muted";
  };

  const typeBg = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("purchase")) return "bg-green/10 border-green/20";
    if (t.includes("sale")) return "bg-red/10 border-red/20";
    return "bg-muted/10 border-muted/20";
  };

  const visibleTrades = expanded ? trades : trades.slice(0, 8);

  return (
    <div className="border border-border bg-card">
      {/* Stats bar */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-muted">
          {ticker && (
            <span className="text-accent font-semibold text-xs">{ticker}</span>
          )}
          <span>US House & Senate Financial Disclosures (STOCK Act)</span>
        </div>
        {stats.total > 0 && (
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-green">{stats.purchases} buys</span>
            <span className="text-red">{stats.sales} sells</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setTab("trades")}
          className={`flex-1 px-4 py-2 text-[10px] tracking-wider transition-colors ${
            tab === "trades"
              ? "text-accent border-b-2 border-accent bg-accent/5 font-semibold"
              : "text-muted hover:text-foreground"
          }`}
        >
          {ticker ? `${ticker} TRADES` : "RECENT TRADES"}
        </button>
        <button
          onClick={() => setTab("top")}
          className={`flex-1 px-4 py-2 text-[10px] tracking-wider transition-colors ${
            tab === "top"
              ? "text-accent border-b-2 border-accent bg-accent/5 font-semibold"
              : "text-muted hover:text-foreground"
          }`}
        >
          MOST BOUGHT BY CONGRESS
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-center">
          <div className="text-accent text-xs animate-pulse">Loading congressional trades...</div>
        </div>
      ) : tab === "trades" ? (
        <div>
          {trades.length === 0 ? (
            <div className="p-6 text-center text-muted text-xs">
              {ticker
                ? `No congressional trades found for ${ticker} in the last 6 months.`
                : "No recent trades found."}
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/50">
                {visibleTrades.map((t, i) => (
                  <div
                    key={`${t.politician}-${t.ticker}-${t.transaction_date}-${i}`}
                    className="px-4 py-2.5 hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {t.politician}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 bg-subtle border border-border text-muted">
                            {t.chamber}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 border font-semibold ${typeBg(t.type)} ${typeColor(t.type)}`}
                          >
                            {t.type.toUpperCase()}
                          </span>
                          {!ticker && (
                            <button
                              onClick={() => onSelectTicker?.(t.ticker)}
                              className="text-accent text-[11px] font-semibold hover:underline"
                            >
                              {t.ticker}
                            </button>
                          )}
                          <span className="text-muted text-[10px] truncate">{t.asset}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-foreground font-medium">{t.amount}</div>
                        <div className="text-[9px] text-muted">{daysAgo(t.transaction_date)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {trades.length > 8 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="w-full py-2 text-[10px] text-accent hover:bg-accent/5 border-t border-border tracking-wider"
                >
                  {expanded ? "SHOW LESS" : `SHOW ALL ${trades.length} TRADES`}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        /* Top Bought tab */
        <div>
          {topBought.length === 0 ? (
            <div className="p-6 text-center text-muted text-xs">Loading top stocks...</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-border">
                  <th className="text-left px-3 py-2 font-normal">#</th>
                  <th className="text-left py-2 font-normal">TICKER</th>
                  <th className="text-right py-2 pr-2 font-normal">BUYS</th>
                  <th className="text-right py-2 pr-2 font-normal">POLITICIANS</th>
                  <th className="text-left py-2 pl-2 font-normal">TOP BUYERS</th>
                </tr>
              </thead>
              <tbody>
                {topBought.slice(0, expanded ? 20 : 10).map((item, i) => (
                  <tr
                    key={item.ticker}
                    className="border-b border-border/50 hover:bg-accent/5 cursor-pointer transition-colors"
                    onClick={() => onSelectTicker?.(item.ticker)}
                  >
                    <td className="px-3 py-2 text-muted/50">{i + 1}</td>
                    <td className="py-2">
                      <span className="text-accent font-semibold">{item.ticker}</span>
                    </td>
                    <td className="py-2 pr-2 text-right text-green font-semibold">
                      {item.purchase_count}
                    </td>
                    <td className="py-2 pr-2 text-right text-foreground">
                      {item.unique_politicians}
                    </td>
                    <td className="py-2 pl-2 text-muted text-[10px] truncate max-w-[200px]">
                      {item.politicians.slice(0, 3).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {topBought.length > 10 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full py-2 text-[10px] text-accent hover:bg-accent/5 border-t border-border tracking-wider"
            >
              {expanded ? "SHOW LESS" : "SHOW ALL 20"}
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border bg-subtle/30">
        <div className="text-[9px] text-muted">
          Source: US House & Senate Financial Disclosures (STOCK Act) | Last 6 months
        </div>
      </div>
    </div>
  );
}
