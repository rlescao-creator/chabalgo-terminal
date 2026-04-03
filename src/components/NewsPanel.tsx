"use client";

import { useEffect, useState } from "react";
import { formatTimestamp } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface NewsItem {
  headline: string;
  source: string;
  url: string;
  datetime: number;
  summary: string;
}

interface SentimentData {
  score: number;
  label: string;
  analysts_total: number;
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
  period: string;
  source: string;
}

interface NewsData {
  ticker: string;
  news: NewsItem[];
  sentiment: SentimentData;
}

export default function NewsPanel({ ticker }: { ticker: string }) {
  const [data, setData] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setLoading(true);
    setExpanded(false);
    fetch(`${API_BASE}/news/${ticker}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-card border border-border p-5">
        <h3 className="text-accent text-xs font-semibold tracking-wider mb-2">WHY IT&apos;S MOVING</h3>
        <div className="text-accent text-xs animate-pulse">Loading news from multiple sources...</div>
      </div>
    );
  }

  if (!data || data.news.length === 0) {
    return (
      <div className="bg-card border border-border p-5">
        <h3 className="text-accent text-xs font-semibold tracking-wider mb-2">WHY IT&apos;S MOVING</h3>
        <div className="text-muted text-sm">No recent news available for {ticker}</div>
      </div>
    );
  }

  const newsToShow = expanded ? data.news : data.news.slice(0, 5);
  const sentiment = data.sentiment;
  const total = sentiment.analysts_total;

  const sentimentColor = () => {
    if (sentiment.label === "Bullish") return "text-green";
    if (sentiment.label === "Bearish") return "text-red";
    return "text-yellow";
  };

  const sentimentBarColor = () => {
    if (sentiment.label === "Bullish") return "bg-green";
    if (sentiment.label === "Bearish") return "bg-red";
    return "bg-yellow";
  };

  // Group sources
  const sources = [...new Set(data.news.map((n) => n.source))];

  // Time ago helper
  const timeAgo = (ts: number) => {
    if (!ts) return "";
    const now = Math.floor(Date.now() / 1000);
    const diff = now - ts;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return formatTimestamp(ts);
  };

  return (
    <div className="bg-card border border-border p-5">
      {/* Header with sentiment badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-accent text-xs font-semibold tracking-wider">WHY IT&apos;S MOVING</h3>
          <span className="text-[10px] text-muted">
            {data.news.length} articles from {sources.length} sources
          </span>
        </div>
        {sentiment.source !== "unavailable" && total > 0 && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${sentimentColor()}`}>
              {sentiment.label.toUpperCase()}
            </span>
            <div className="w-12 h-1.5 bg-subtle rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${sentimentBarColor()}`}
                style={{ width: `${sentiment.score * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted">{total} analysts</span>
          </div>
        )}
      </div>

      {/* Analyst breakdown bar */}
      {sentiment.source !== "unavailable" && total > 0 && (
        <div className="mb-4 pb-4 border-b border-border">
          <div className="flex gap-0 w-full h-2 overflow-hidden rounded-full">
            {sentiment.strong_buy > 0 && (
              <div className="h-full bg-green" style={{ width: `${(sentiment.strong_buy / total) * 100}%` }} title={`Strong Buy: ${sentiment.strong_buy}`} />
            )}
            {sentiment.buy > 0 && (
              <div className="h-full bg-green/60" style={{ width: `${(sentiment.buy / total) * 100}%` }} title={`Buy: ${sentiment.buy}`} />
            )}
            {sentiment.hold > 0 && (
              <div className="h-full bg-yellow" style={{ width: `${(sentiment.hold / total) * 100}%` }} title={`Hold: ${sentiment.hold}`} />
            )}
            {sentiment.sell > 0 && (
              <div className="h-full bg-red/60" style={{ width: `${(sentiment.sell / total) * 100}%` }} title={`Sell: ${sentiment.sell}`} />
            )}
            {sentiment.strong_sell > 0 && (
              <div className="h-full bg-red" style={{ width: `${(sentiment.strong_sell / total) * 100}%` }} title={`Strong Sell: ${sentiment.strong_sell}`} />
            )}
          </div>
          <div className="flex justify-between text-[10px] mt-1.5 text-muted">
            <div className="flex gap-3">
              <span className="text-green">BUY {sentiment.strong_buy + sentiment.buy}</span>
              <span className="text-yellow">HOLD {sentiment.hold}</span>
              <span className="text-red">SELL {sentiment.sell + sentiment.strong_sell}</span>
            </div>
            <span className="text-muted/50">{sentiment.period}</span>
          </div>
        </div>
      )}

      {/* News articles */}
      <div className="space-y-3">
        {newsToShow.map((item, i) => (
          <div key={i} className="group">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-1 rounded-full bg-border group-hover:bg-accent transition-colors" />
              <div className="flex-1 min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-foreground hover:text-accent transition-colors leading-snug block"
                >
                  {item.headline}
                </a>
                {item.summary && (
                  <div className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">
                    {item.summary}
                  </div>
                )}
                <div className="flex gap-3 mt-1 text-[10px] text-muted/60">
                  <span className="font-medium text-muted/80">{item.source}</span>
                  {item.datetime > 0 && <span>{timeAgo(item.datetime)}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Show more */}
      {data.news.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent hover:text-accent/80 mt-3 transition-colors"
        >
          {expanded ? "Show less" : `Show all ${data.news.length} articles`}
        </button>
      )}

      {/* Source attribution */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="text-[10px] text-muted/40">
          Sources: {sources.join(", ")}
        </div>
      </div>
    </div>
  );
}
