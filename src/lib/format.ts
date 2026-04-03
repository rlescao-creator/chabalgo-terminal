export function formatPrice(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toFixed(2);
}

export function formatPct(n: number | null | undefined): string {
  if (n == null) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function formatLargeNumber(n: number | null | undefined): string {
  if (n == null) return "--";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function formatTimestamp(ts: number): string {
  if (!ts) return "--";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function colorForValue(val: number): string {
  if (val > 0) return "text-green";
  if (val < 0) return "text-red";
  return "text-yellow";
}

export function colorForSignal(signal: string | null): string {
  if (!signal) return "text-foreground";
  const s = signal.toLowerCase();
  if (s === "bullish" || s === "above" || s === "oversold") return "text-green";
  if (s === "bearish" || s === "below" || s === "overbought") return "text-red";
  return "text-yellow";
}
