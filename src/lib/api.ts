import { AnalysisData, PortfolioPnL } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchAnalysis(ticker: string): Promise<AnalysisData> {
  const res = await fetch(`${API_BASE}/analyze/${encodeURIComponent(ticker)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || `Error ${res.status}`);
  }
  return res.json();
}

export async function fetchPortfolioPnL(): Promise<PortfolioPnL> {
  const res = await fetch(`${API_BASE}/portfolio/pnl`);
  if (!res.ok) throw new Error("Failed to fetch portfolio");
  return res.json();
}

export async function addPosition(ticker: string, shares: number, avg_price: number) {
  const res = await fetch(`${API_BASE}/portfolio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, shares, avg_price }),
  });
  if (!res.ok) throw new Error("Failed to add position");
  return res.json();
}

export async function removePosition(ticker: string) {
  const res = await fetch(`${API_BASE}/portfolio/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to remove position");
  return res.json();
}
