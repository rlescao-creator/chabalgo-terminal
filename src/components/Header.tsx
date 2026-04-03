"use client";

import { AnalysisData } from "@/lib/types";
import { formatPrice, formatPct, formatLargeNumber, colorForValue } from "@/lib/format";

export default function Header({ data }: { data: AnalysisData }) {
  const { ticker, profile, price } = data;
  const changeColor = colorForValue(price.change);
  const currencySymbol = price.currency === "EUR" ? "€" : price.currency === "GBP" ? "£" : "$";

  return (
    <div className="bg-card border border-border p-5">
      <div className="flex items-baseline gap-4 flex-wrap">
        <span className="text-accent text-2xl font-semibold tracking-wide">{ticker}</span>
        <span className="text-foreground text-sm">{profile.name}</span>
        {profile.exchange && (
          <span className="text-muted text-xs">{profile.exchange}</span>
        )}
        {price.currency && price.currency !== "USD" && (
          <span className="text-accent/60 text-xs font-medium">{price.currency}</span>
        )}
      </div>
      <div className="flex items-baseline gap-6 mt-3 flex-wrap">
        <span className="text-foreground text-2xl font-light">{currencySymbol}{formatPrice(price.price)}</span>
        <span className={`text-sm font-medium ${changeColor}`}>
          {price.change >= 0 ? "+" : ""}{formatPrice(price.change)} ({formatPct(price.change_percent)})
        </span>
        <div className="flex gap-4 text-xs text-muted">
          <span>O: {formatPrice(price.open)}</span>
          <span>H: {formatPrice(price.high)}</span>
          <span>L: {formatPrice(price.low)}</span>
          <span>PC: {formatPrice(price.prev_close)}</span>
        </div>
        <span className="text-xs text-muted">
          MCap: {formatLargeNumber(profile.market_cap)}
        </span>
        <span className="text-xs text-muted/40">[{price.source}]</span>
      </div>
    </div>
  );
}
