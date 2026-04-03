"use client";

import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { PortfolioPnL, PortfolioPosition } from "@/lib/types";
import { addPosition, removePosition, fetchPortfolioPnL } from "@/lib/api";
import { formatPrice, formatPct, colorForValue } from "@/lib/format";

const COLORS = ["#c8f05a", "#ff4d4d", "#f0c040", "#4d9fff", "#ff7b4d", "#9b59b6", "#1abc9c", "#e67e22"];

export default function Portfolio() {
  const [open, setOpen] = useState(false);
  const [pnl, setPnl] = useState<PortfolioPnL | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ ticker: "", shares: "", price: "" });
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPortfolioPnL();
      setPnl(data);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const ticker = form.ticker.trim().toUpperCase();
    const shares = parseFloat(form.shares);
    const price = parseFloat(form.price);
    if (!ticker || isNaN(shares) || isNaN(price) || shares <= 0 || price <= 0) {
      setError("Invalid input");
      return;
    }
    try {
      await addPosition(ticker, shares, price);
      setForm({ ticker: "", shares: "", price: "" });
      refresh();
    } catch {
      setError("Failed to add position");
    }
  };

  const handleRemove = async (ticker: string) => {
    try {
      await removePosition(ticker);
      refresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed right-0 top-0 h-full z-50 flex">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className="h-full w-6 bg-[#111] border-l border-border flex items-center justify-center text-[10px] text-[#555] hover:text-accent transition-colors"
        style={{ writingMode: "vertical-rl" }}
      >
        {open ? "CLOSE" : "PORTFOLIO"}
      </button>

      {/* Sidebar */}
      {open && (
        <div className="w-72 bg-[#0d0d0d] border-l border-border h-full overflow-y-auto p-3">
          <h2 className="text-accent text-xs font-bold mb-3">PORTFOLIO</h2>

          {/* Add form */}
          <form onSubmit={handleAdd} className="mb-4 space-y-1">
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="TICKER"
                value={form.ticker}
                onChange={(e) => setForm({ ...form, ticker: e.target.value })}
                className="w-20 bg-[#111] border border-border text-xs text-foreground px-1.5 py-1 font-mono outline-none focus:border-accent"
              />
              <input
                type="number"
                step="any"
                placeholder="QTY"
                value={form.shares}
                onChange={(e) => setForm({ ...form, shares: e.target.value })}
                className="w-16 bg-[#111] border border-border text-xs text-foreground px-1.5 py-1 font-mono outline-none focus:border-accent"
              />
              <input
                type="number"
                step="any"
                placeholder="AVG $"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-20 bg-[#111] border border-border text-xs text-foreground px-1.5 py-1 font-mono outline-none focus:border-accent"
              />
            </div>
            <button
              type="submit"
              className="w-full text-[10px] py-1 border border-accent text-accent hover:bg-accent hover:text-black transition-colors"
            >
              ADD POSITION
            </button>
            {error && <div className="text-red text-[10px]">{error}</div>}
          </form>

          {loading && <div className="text-yellow text-[10px] animate-pulse mb-2">Loading...</div>}

          {pnl && pnl.positions.length > 0 && (
            <>
              {/* Totals */}
              <div className="border border-border p-2 mb-3">
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#666]">Total Value</span>
                  <span className="text-foreground">{formatPrice(pnl.total_value)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#666]">Total P&L</span>
                  <span className={colorForValue(pnl.total_pnl)}>
                    {formatPrice(pnl.total_pnl)} ({formatPct(pnl.total_pnl_pct)})
                  </span>
                </div>
              </div>

              {/* Donut chart */}
              <div className="h-32 mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pnl.positions}
                      dataKey="value"
                      nameKey="ticker"
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={50}
                      strokeWidth={1}
                      stroke="#0a0a0a"
                    >
                      {pnl.positions.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#111",
                        border: "1px solid #222",
                        fontSize: 10,
                        fontFamily: "monospace",
                      }}
                      formatter={(value, name) => [`$${Number(value).toFixed(2)}`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Positions list */}
              <div className="space-y-1">
                {pnl.positions.map((pos) => (
                  <div key={pos.ticker} className="border border-border p-2 group">
                    <div className="flex justify-between items-center">
                      <span className="text-accent text-xs font-bold">{pos.ticker}</span>
                      <button
                        onClick={() => handleRemove(pos.ticker)}
                        className="text-[#333] text-[10px] hover:text-red opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        [X]
                      </button>
                    </div>
                    <div className="flex justify-between text-[10px] mt-0.5">
                      <span className="text-[#666]">{pos.shares} @ {formatPrice(pos.avg_price)}</span>
                      <span className="text-foreground">{formatPrice(pos.current_price)}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#555]">{pos.allocation_pct?.toFixed(1)}%</span>
                      <span className={colorForValue(pos.pnl || 0)}>
                        {formatPrice(pos.pnl)} ({formatPct(pos.pnl_pct)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {pnl && pnl.positions.length === 0 && !loading && (
            <div className="text-[#555] text-xs">No positions. Add one above.</div>
          )}
        </div>
      )}
    </div>
  );
}
