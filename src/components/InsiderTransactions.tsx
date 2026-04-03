"use client";

import { useEffect, useState } from "react";
import { formatLargeNumber } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Transaction {
  name: string;
  type: string;
  shares: number;
  price: number | null;
  value: number;
  date: string;
  filing_date: string;
}

interface InsiderSummary {
  name: string;
  buy_value: number;
  sell_value: number;
  buy_shares: number;
  sell_shares: number;
  tx_count: number;
}

interface Summary {
  by_insider: InsiderSummary[];
  total_buy_value: number;
  total_sell_value: number;
  total_transactions: number;
  period_from: string;
  period_to: string;
}

type ViewMode = "summary" | "all";

function buildInsiderSummary(summary: Summary | null, transactions: Transaction[], ticker: string): string {
  if (!summary || transactions.length === 0) return "";
  const parts: string[] = [];

  const totalBuys = summary.total_buy_value;
  const totalSells = summary.total_sell_value;
  const ratio = totalSells > 0 && totalBuys > 0 ? totalSells / totalBuys : 0;

  if (totalBuys > 0 && totalSells === 0) {
    parts.push(`Insiders have been exclusively buying ${ticker} — $${formatLargeNumber(totalBuys)} in purchases with zero sells. This is a strong bullish signal from those who know the company best.`);
  } else if (totalSells > 0 && totalBuys === 0) {
    if (totalSells > 10e6) {
      parts.push(`Heavy insider selling: $${formatLargeNumber(totalSells)} in sales with no insider buys. While insiders sell for many reasons (diversification, taxes), the magnitude here warrants attention.`);
    } else {
      parts.push(`Insiders have been net sellers ($${formatLargeNumber(totalSells)}). Routine selling for diversification is common, especially after vesting events.`);
    }
  } else if (ratio > 10) {
    parts.push(`Insider sells outpace buys by ${ratio.toFixed(0)}:1 ($${formatLargeNumber(totalSells)} sold vs $${formatLargeNumber(totalBuys)} bought). The skew is notable but may reflect normal compensation-related activity.`);
  } else if (ratio > 3) {
    parts.push(`More insider selling than buying (${ratio.toFixed(1)}:1 ratio). Not unusual for a growing company where equity compensation is a major part of pay.`);
  } else if (totalBuys > totalSells) {
    parts.push(`Net insider buying is a positive sign — insiders have purchased more than they've sold, signaling confidence in the stock's direction.`);
  }

  // Notable individuals
  if (summary.by_insider.length > 0) {
    const biggestSeller = summary.by_insider.reduce((a, b) => b.sell_value > a.sell_value ? b : a);
    if (biggestSeller.sell_value > 1e6) {
      parts.push(`Largest seller: ${biggestSeller.name} ($${formatLargeNumber(biggestSeller.sell_value)}).`);
    }
    const biggestBuyer = summary.by_insider.reduce((a, b) => b.buy_value > a.buy_value ? b : a);
    if (biggestBuyer.buy_value > 100000) {
      parts.push(`Largest buyer: ${biggestBuyer.name} ($${formatLargeNumber(biggestBuyer.buy_value)}).`);
    }
  }

  return parts.join(" ");
}

export default function InsiderTransactions({ ticker }: { ticker: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("summary");

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/insiders/${ticker}`)
      .then((r) => r.json())
      .then((d) => {
        setTransactions(d.transactions || []);
        setSummary(d.summary || null);
      })
      .catch(() => {
        setTransactions([]);
        setSummary(null);
      })
      .finally(() => setLoading(false));
  }, [ticker]);

  const typeColor = (t: string) => {
    if (t === "BUY") return "text-green";
    if (t === "SELL") return "text-red";
    return "text-yellow";
  };

  const totalBuys = summary?.total_buy_value || 0;
  const totalSells = summary?.total_sell_value || 0;
  const totalFlow = totalBuys + totalSells;

  return (
    <div className="bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-accent text-xs font-semibold tracking-wider">INSIDER TRANSACTIONS</h3>
        {transactions.length > 0 && (
          <div className="flex gap-0 border border-border">
            <button
              onClick={() => setView("summary")}
              className={`px-3 py-1 text-xs transition-colors ${
                view === "summary" ? "bg-accent text-white" : "text-muted hover:text-foreground"
              }`}
            >
              SUMMARY
            </button>
            <button
              onClick={() => setView("all")}
              className={`px-3 py-1 text-xs border-l border-border transition-colors ${
                view === "all" ? "bg-accent text-white" : "text-muted hover:text-foreground"
              }`}
            >
              ALL ({transactions.length})
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-accent text-xs animate-pulse">Loading insider data...</div>
      ) : transactions.length === 0 ? (
        <div className="text-muted text-sm">No insider transactions in last 6 months</div>
      ) : (
        <>
          <div className="flex gap-4 mb-3 text-xs">
            <span className="text-green font-medium">BUYS: ${formatLargeNumber(totalBuys)}</span>
            <span className="text-red font-medium">SELLS: ${formatLargeNumber(totalSells)}</span>
            <span className="text-muted">{summary?.period_from} to {summary?.period_to}</span>
          </div>

          {totalFlow > 0 && (
            <div className="w-full h-1.5 bg-subtle mb-4 flex rounded-full overflow-hidden">
              {totalBuys > 0 && (
                <div className="h-full bg-green" style={{ width: `${(totalBuys / totalFlow) * 100}%` }} />
              )}
              {totalSells > 0 && (
                <div className="h-full bg-red" style={{ width: `${(totalSells / totalFlow) * 100}%` }} />
              )}
            </div>
          )}

          {view === "summary" && summary ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted text-left border-b border-border">
                    <th className="pb-2 pr-2 font-normal">INSIDER</th>
                    <th className="pb-2 pr-2 font-normal text-right">BUYS</th>
                    <th className="pb-2 pr-2 font-normal text-right">SELLS</th>
                    <th className="pb-2 font-normal text-right">NET</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.by_insider.map((ins, i) => {
                    const net = ins.buy_value - ins.sell_value;
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-subtle transition-colors">
                        <td className="py-2 pr-2 text-foreground truncate max-w-[180px]">
                          {ins.name}
                          <span className="text-muted ml-1 text-[10px]">({ins.tx_count})</span>
                        </td>
                        <td className="py-2 pr-2 text-right text-green">
                          {ins.buy_value > 0 ? `$${formatLargeNumber(ins.buy_value)}` : "--"}
                        </td>
                        <td className="py-2 pr-2 text-right text-red">
                          {ins.sell_value > 0 ? `$${formatLargeNumber(ins.sell_value)}` : "--"}
                        </td>
                        <td className={`py-2 text-right font-semibold ${net >= 0 ? "text-green" : "text-red"}`}>
                          {net >= 0 ? "+" : "-"}${formatLargeNumber(Math.abs(net))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-muted text-left border-b border-border">
                    <th className="pb-2 pr-2 font-normal">DATE</th>
                    <th className="pb-2 pr-2 font-normal">INSIDER</th>
                    <th className="pb-2 pr-2 font-normal">TYPE</th>
                    <th className="pb-2 pr-2 font-normal text-right">SHARES</th>
                    <th className="pb-2 pr-2 font-normal text-right">PRICE</th>
                    <th className="pb-2 font-normal text-right">VALUE</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-subtle transition-colors">
                      <td className="py-1.5 pr-2 text-muted whitespace-nowrap">{tx.date}</td>
                      <td className="py-1.5 pr-2 text-foreground truncate max-w-[140px]">{tx.name}</td>
                      <td className={`py-1.5 pr-2 font-semibold ${typeColor(tx.type)}`}>{tx.type}</td>
                      <td className={`py-1.5 pr-2 text-right ${tx.shares > 0 ? "text-green" : "text-red"}`}>
                        {tx.shares > 0 ? "+" : ""}{formatLargeNumber(tx.shares)}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-muted">
                        {tx.price ? `$${tx.price.toFixed(2)}` : "--"}
                      </td>
                      <td className={`py-1.5 text-right ${tx.type === "BUY" ? "text-green" : "text-red"}`}>
                        ${formatLargeNumber(tx.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary */}
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-[11px] text-muted leading-relaxed">
              {buildInsiderSummary(summary, transactions, ticker)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
