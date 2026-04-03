"use client";

import { useEffect, useState } from "react";
import { formatLargeNumber } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface PeerData {
  ticker: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  forward_pe: number | null;
  revenue_growth: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  rsi: number | null;
  is_target: boolean;
}

function buildPeerSummary(peers: PeerData[], ticker: string): string {
  if (peers.length < 2) return "";
  const target = peers.find(p => p.is_target);
  const others = peers.filter(p => !p.is_target && p.pe_ratio != null);
  if (!target) return "";

  const parts: string[] = [];

  // Valuation comparison
  if (target.pe_ratio != null && others.length > 0) {
    const avgPe = others.reduce((s, p) => s + (p.pe_ratio || 0), 0) / others.length;
    if (target.pe_ratio > avgPe * 1.2) {
      parts.push(`${ticker} trades at a premium (${target.pe_ratio.toFixed(1)}x PE) vs its peer average of ${avgPe.toFixed(1)}x — the market values it higher, likely due to stronger growth or margins.`);
    } else if (target.pe_ratio < avgPe * 0.8) {
      parts.push(`${ticker} looks undervalued at ${target.pe_ratio.toFixed(1)}x PE vs the peer average of ${avgPe.toFixed(1)}x — either a value opportunity or a reflection of weaker fundamentals.`);
    } else {
      parts.push(`${ticker}'s valuation (${target.pe_ratio.toFixed(1)}x PE) is in line with its peer group average of ${avgPe.toFixed(1)}x.`);
    }
  }

  // Growth comparison
  if (target.revenue_growth != null) {
    const growthPeers = others.filter(p => p.revenue_growth != null);
    if (growthPeers.length > 0) {
      const avgGrowth = growthPeers.reduce((s, p) => s + (p.revenue_growth || 0), 0) / growthPeers.length;
      const fastest = [...peers].filter(p => p.revenue_growth != null).sort((a, b) => (b.revenue_growth || 0) - (a.revenue_growth || 0))[0];
      if (fastest && fastest.ticker === ticker) {
        parts.push(`It leads the peer group in revenue growth at ${target.revenue_growth.toFixed(1)}%.`);
      } else if (target.revenue_growth > avgGrowth) {
        parts.push(`Growth of ${target.revenue_growth.toFixed(1)}% outpaces the peer average of ${avgGrowth.toFixed(1)}%.`);
      } else {
        parts.push(`Revenue growth of ${target.revenue_growth.toFixed(1)}% trails the peer average of ${avgGrowth.toFixed(1)}% — it's losing ground competitively.`);
      }
    }
  }

  // Margin comparison
  if (target.operating_margin != null) {
    const marginPeers = others.filter(p => p.operating_margin != null);
    if (marginPeers.length > 0) {
      const bestMarginPeer = [...peers].filter(p => p.operating_margin != null).sort((a, b) => (b.operating_margin || 0) - (a.operating_margin || 0))[0];
      if (bestMarginPeer && bestMarginPeer.ticker === ticker) {
        parts.push(`${ticker} has the highest operating margin in the group at ${target.operating_margin.toFixed(1)}% — a clear efficiency leader.`);
      }
    }
  }

  return parts.join(" ");
}

export default function PeerComparison({ ticker }: { ticker: string }) {
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/peers/${ticker}`)
      .then((r) => r.json())
      .then((d) => setPeers(d.peers || []))
      .catch(() => setPeers([]))
      .finally(() => setLoading(false));
  }, [ticker]);

  const val = (v: number | null, suffix = "", prefix = "") => {
    if (v == null) return <span className="text-muted/30">--</span>;
    return `${prefix}${v.toFixed(1)}${suffix}`;
  };

  const colorVal = (v: number | null) => {
    if (v == null) return "text-muted/30";
    if (v > 0) return "text-green";
    if (v < 0) return "text-red";
    return "text-muted";
  };

  const rsiColor = (v: number | null) => {
    if (v == null) return "text-muted/30";
    if (v > 65) return "text-red";
    if (v < 35) return "text-green";
    return "text-yellow";
  };

  const bestInCol = (key: keyof PeerData, higher = true) => {
    const vals = peers
      .filter((p) => p[key] != null)
      .map((p) => ({ ticker: p.ticker, val: p[key] as number }));
    if (vals.length === 0) return "";
    vals.sort((a, b) => (higher ? b.val - a.val : a.val - b.val));
    return vals[0].ticker;
  };

  const bestGrowth = bestInCol("revenue_growth", true);
  const bestMargin = bestInCol("operating_margin", true);

  return (
    <div className="bg-card border border-border p-5">
      <h3 className="text-accent text-xs font-semibold tracking-wider mb-4">PEER COMPARISON</h3>

      {loading ? (
        <div className="text-accent text-xs animate-pulse">Loading peer data (this may take a moment)...</div>
      ) : peers.length === 0 ? (
        <div className="text-muted text-sm">No peer data available</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-border text-right">
                <th className="pb-2 text-left font-normal">TICKER</th>
                <th className="pb-2 font-normal pr-2">PRICE</th>
                <th className="pb-2 font-normal pr-2">CHG%</th>
                <th className="pb-2 font-normal pr-2">MCAP</th>
                <th className="pb-2 font-normal pr-2">PE</th>
                <th className="pb-2 font-normal pr-2">FWD PE</th>
                <th className="pb-2 font-normal pr-2">REV GRW</th>
                <th className="pb-2 font-normal pr-2">GROSS M</th>
                <th className="pb-2 font-normal pr-2">OP M</th>
                <th className="pb-2 font-normal">RSI</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((p, i) => (
                <tr
                  key={`${p.ticker}-${i}`}
                  className={`border-b border-border/50 text-right transition-colors ${
                    p.is_target ? "bg-accent/5" : "hover:bg-subtle"
                  }`}
                >
                  <td className="py-2 text-left">
                    <span className={p.is_target ? "text-accent font-semibold" : "text-foreground"}>
                      {p.ticker}
                    </span>
                    {p.is_target && <span className="text-accent/40 ml-1 text-[10px]">&lt;</span>}
                  </td>
                  <td className="py-2 pr-2 text-foreground">
                    {p.price != null ? `$${p.price.toFixed(2)}` : "--"}
                  </td>
                  <td className={`py-2 pr-2 ${colorVal(p.change_pct)}`}>
                    {p.change_pct != null ? `${p.change_pct >= 0 ? "+" : ""}${p.change_pct.toFixed(1)}%` : "--"}
                  </td>
                  <td className="py-2 pr-2 text-muted">{p.market_cap != null ? formatLargeNumber(p.market_cap) : "--"}</td>
                  <td className="py-2 pr-2 text-muted">{val(p.pe_ratio)}</td>
                  <td className="py-2 pr-2 text-muted">{val(p.forward_pe)}</td>
                  <td className={`py-2 pr-2 ${colorVal(p.revenue_growth)} ${p.ticker === bestGrowth ? "font-semibold" : ""}`}>
                    {p.revenue_growth != null ? `${p.revenue_growth >= 0 ? "+" : ""}${p.revenue_growth.toFixed(1)}%` : "--"}
                  </td>
                  <td className="py-2 pr-2 text-muted">{p.gross_margin != null ? `${p.gross_margin.toFixed(1)}%` : "--"}</td>
                  <td className={`py-2 pr-2 ${p.ticker === bestMargin ? "text-green font-semibold" : "text-muted"}`}>
                    {p.operating_margin != null ? `${p.operating_margin.toFixed(1)}%` : "--"}
                  </td>
                  <td className={`py-2 ${rsiColor(p.rsi)}`}>{p.rsi != null ? p.rsi.toFixed(1) : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {peers.length >= 2 && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-[11px] text-muted leading-relaxed">{buildPeerSummary(peers, ticker)}</p>
        </div>
      )}
    </div>
  );
}
