"use client";

import { AnalysisData } from "@/lib/types";
import { formatTimestamp, colorForSignal } from "@/lib/format";

export default function NewsSentiment({ data }: { data: AnalysisData }) {
  const { news, sentiment } = data;

  const barWidth = Math.max(5, Math.min(95, sentiment.score * 100));
  const barColor =
    sentiment.label === "Bullish" ? "bg-accent" :
    sentiment.label === "Bearish" ? "bg-red" : "bg-yellow";

  const total = sentiment.analysts_total;

  return (
    <div className="border border-border p-4">
      <h3 className="text-accent text-xs font-bold mb-3">NEWS + ANALYST SENTIMENT</h3>

      {/* Analyst sentiment */}
      <div className="mb-4">
        <div className="flex justify-between text-[10px] text-[#555] mb-1">
          <span>Bearish</span>
          <span className={colorForSignal(sentiment.label)}>
            {sentiment.label} ({(sentiment.score * 100).toFixed(0)}%)
          </span>
          <span>Bullish</span>
        </div>
        <div className="w-full h-1.5 bg-[#1a1a1a]">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        {sentiment.source !== "unavailable" && total > 0 && (
          <div className="mt-2">
            <div className="flex gap-0 w-full h-3 overflow-hidden">
              {sentiment.strong_buy > 0 && (
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(sentiment.strong_buy / total) * 100}%` }}
                  title={`Strong Buy: ${sentiment.strong_buy}`}
                />
              )}
              {sentiment.buy > 0 && (
                <div
                  className="h-full bg-[#8ab83a]"
                  style={{ width: `${(sentiment.buy / total) * 100}%` }}
                  title={`Buy: ${sentiment.buy}`}
                />
              )}
              {sentiment.hold > 0 && (
                <div
                  className="h-full bg-yellow"
                  style={{ width: `${(sentiment.hold / total) * 100}%` }}
                  title={`Hold: ${sentiment.hold}`}
                />
              )}
              {sentiment.sell > 0 && (
                <div
                  className="h-full bg-[#cc4444]"
                  style={{ width: `${(sentiment.sell / total) * 100}%` }}
                  title={`Sell: ${sentiment.sell}`}
                />
              )}
              {sentiment.strong_sell > 0 && (
                <div
                  className="h-full bg-red"
                  style={{ width: `${(sentiment.strong_sell / total) * 100}%` }}
                  title={`Strong Sell: ${sentiment.strong_sell}`}
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] mt-1.5">
              <div className="flex gap-3">
                <span className="text-accent">STR.BUY {sentiment.strong_buy}</span>
                <span className="text-[#8ab83a]">BUY {sentiment.buy}</span>
                <span className="text-yellow">HOLD {sentiment.hold}</span>
                <span className="text-[#cc4444]">SELL {sentiment.sell}</span>
                <span className="text-red">STR.SELL {sentiment.strong_sell}</span>
              </div>
            </div>
            <div className="text-[10px] text-[#333] mt-1">
              {total} analysts | {sentiment.period} [{sentiment.source}]
            </div>
          </div>
        )}
      </div>

      {/* News list */}
      {news.length === 0 ? (
        <div className="text-[#555] text-xs">No recent news available</div>
      ) : (
        <div className="space-y-2">
          {news.map((item, i) => (
            <div key={i} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-foreground hover:text-accent transition-colors block leading-tight"
              >
                {item.headline}
              </a>
              <div className="flex gap-3 mt-0.5 text-[10px] text-[#555]">
                <span>{item.source}</span>
                <span>{formatTimestamp(item.datetime)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
