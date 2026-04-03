"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { HistoricalPoint } from "@/lib/types";

interface ChartsProps {
  data: HistoricalPoint[];
  ticker: string;
}

function buildChartSummary(data: HistoricalPoint[], ticker: string): string {
  if (data.length < 10) return "";
  const parts: string[] = [];

  const latest = data[data.length - 1];
  const first = data[0];
  const totalReturn = ((latest.close - first.close) / first.close * 100);

  const d90 = data.slice(-90);
  const d30 = data.slice(-30);
  const d7 = data.slice(-7);

  const ret90 = d90.length > 1 ? ((d90[d90.length - 1].close - d90[0].close) / d90[0].close * 100) : 0;
  const ret30 = d30.length > 1 ? ((d30[d30.length - 1].close - d30[0].close) / d30[0].close * 100) : 0;
  const ret7 = d7.length > 1 ? ((d7[d7.length - 1].close - d7[0].close) / d7[0].close * 100) : 0;

  // Overall 1Y performance
  if (totalReturn > 30) {
    parts.push(`${ticker} has delivered an impressive ${totalReturn.toFixed(1)}% return over the past year, significantly outperforming the S&P 500's historical average of ~10%. This kind of outperformance reflects strong investor conviction and fundamental momentum driving the stock higher.`);
  } else if (totalReturn > 0) {
    parts.push(`${ticker} returned ${totalReturn.toFixed(1)}% over the past year. ${totalReturn > 10 ? "While positive, it's roughly in line with the broader market, suggesting the stock has tracked its sector without a clear breakout catalyst." : "A modest positive return that underperforms the broader market — the stock has been range-bound without strong conviction from buyers."}`);
  } else {
    parts.push(`${ticker} has declined ${Math.abs(totalReturn).toFixed(1)}% over the past year, underperforming the broader market. Investors who bought a year ago are underwater, and the negative return signals that the market has been repricing the stock lower due to deteriorating fundamentals, sector headwinds, or changing growth expectations.`);
  }

  // 90-day trend
  if (ret90 < -20) {
    parts.push(`The last 90 days have been particularly painful, with the stock dropping ${Math.abs(ret90).toFixed(1)}%. A decline of this magnitude over three months typically indicates a fundamental shift — either a disappointing earnings report, guidance cut, or macro headwind that is causing investors to reassess the stock's value.`);
  } else if (ret90 < -10) {
    parts.push(`Over the last 90 days, the stock has pulled back ${Math.abs(ret90).toFixed(1)}%. This could represent a healthy correction within a longer-term uptrend, or the beginning of a more sustained downturn — the distinction often becomes clear at the next earnings report.`);
  } else if (ret90 > 20) {
    parts.push(`The stock has rallied ${ret90.toFixed(1)}% over the last 90 days — a strong move that shows accelerating buyer interest. Gains of this magnitude in a quarter often attract momentum traders, but also increase the risk of a sharp pullback if any negative catalyst emerges.`);
  } else if (ret90 > 10) {
    parts.push(`A solid ${ret90.toFixed(1)}% gain over 90 days shows steady accumulation by investors, with the stock trending higher without the volatility that often accompanies sharp rallies.`);
  }

  // Weekly action
  if (ret7 < -7) {
    parts.push(`This week has seen aggressive selling, with ${ticker} dropping ${Math.abs(ret7).toFixed(1)}%. This kind of sharp weekly decline often triggers stop-losses and margin calls, which can accelerate the move. Watch for whether the stock finds support at its moving averages or continues to break down.`);
  } else if (ret7 < -3) {
    parts.push(`The stock slid ${Math.abs(ret7).toFixed(1)}% this week — moderate selling pressure that could be a short-term dip or the start of a larger move lower depending on upcoming catalysts.`);
  } else if (ret7 > 7) {
    parts.push(`A ${ret7.toFixed(1)}% surge this week signals a potential trend reversal or breakout. Moves of this size in a single week are often driven by news catalysts (earnings, upgrades, or sector rotation) and tend to carry momentum into the following week.`);
  } else if (ret7 > 3) {
    parts.push(`Positive momentum this week with a ${ret7.toFixed(1)}% gain, suggesting buyers are stepping in and the short-term sentiment is shifting favorably.`);
  }

  // 52-week high/low proximity
  const high52 = Math.max(...data.map(d => d.high));
  const low52 = Math.min(...data.map(d => d.low));
  const pctFromHigh = ((latest.close - high52) / high52 * 100);
  const pctFromLow = ((latest.close - low52) / low52 * 100);

  if (Math.abs(pctFromHigh) < 3) {
    parts.push(`${ticker} is trading within 3% of its 52-week high ($${high52.toFixed(2)}) — a sign of strong bullish sentiment. Stocks near highs tend to either break out to new highs (if volume confirms) or face resistance and pull back. Watch volume closely for direction clues.`);
  } else if (Math.abs(pctFromHigh) < 10) {
    parts.push(`The stock sits ${Math.abs(pctFromHigh).toFixed(1)}% below its 52-week high of $${high52.toFixed(2)}. A relatively minor drawdown that could represent a buy-the-dip opportunity if the underlying trend remains intact.`);
  } else if (pctFromHigh < -30) {
    parts.push(`${ticker} is trading ${Math.abs(pctFromHigh).toFixed(0)}% below its 52-week high of $${high52.toFixed(2)} — a substantial drawdown that puts the stock in correction territory. At $${latest.close.toFixed(2)}, the stock is ${pctFromLow.toFixed(0)}% above its 52-week low of $${low52.toFixed(2)}. The wide range between the high and low indicates significant volatility and uncertainty about the stock's fair value.`);
  } else if (pctFromHigh < -15) {
    parts.push(`Trading ${Math.abs(pctFromHigh).toFixed(0)}% off its 52-week high ($${high52.toFixed(2)}), ${ticker} has given back a meaningful portion of its gains. The 52-week low sits at $${low52.toFixed(2)}, which represents a key support level if selling continues.`);
  }

  // Volume analysis
  const recentVol = d7.reduce((s, d) => s + d.volume, 0) / d7.length;
  const olderVol = d30.slice(0, 20).reduce((s, d) => s + d.volume, 0) / Math.max(d30.slice(0, 20).length, 1);
  if (olderVol > 0) {
    const volRatio = recentVol / olderVol;
    if (volRatio > 2) {
      parts.push(`Volume has spiked dramatically to ${volRatio.toFixed(1)}x the 30-day average — a clear sign that something fundamental has changed. Extreme volume often accompanies institutional repositioning, major news events, or options expiry, and typically leads to sustained moves in the direction of the breakout.`);
    } else if (volRatio > 1.4) {
      parts.push(`Trading volume is running ${((volRatio - 1) * 100).toFixed(0)}% above its 30-day average, indicating above-normal interest. Elevated volume during a move gives it more conviction — whether the stock is rising or falling, higher volume means more participants agree with the direction.`);
    } else if (volRatio < 0.6) {
      parts.push(`Volume has dried up to just ${(volRatio * 100).toFixed(0)}% of the 30-day average. Low volume often precedes a significant move — the market is coiling, and a catalyst could trigger a sharp breakout in either direction.`);
    }
  }

  return parts.join(" ");
}

export default function Charts({ data, ticker }: ChartsProps) {
  const [range, setRange] = useState<"90d" | "1y">("90d");

  const filtered = useMemo(() => {
    if (range === "90d") return data.slice(-90);
    return data;
  }, [data, range]);

  if (!data.length) {
    return (
      <div className="bg-card border border-border p-5">
        <h3 className="text-accent text-xs font-semibold tracking-wider mb-2">CHARTS</h3>
        <span className="text-muted text-sm">No historical data available</span>
      </div>
    );
  }

  const priceMin = Math.min(...filtered.map((d) => d.low)) * 0.98;
  const priceMax = Math.max(...filtered.map((d) => d.high)) * 1.02;

  return (
    <div className="bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-accent text-xs font-semibold tracking-wider">
          {ticker} PRICE / MA / RSI / VOLUME
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => setRange("90d")}
            className={`text-xs px-3 py-1 border transition-colors ${
              range === "90d"
                ? "border-accent text-accent bg-accent/5"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            90D
          </button>
          <button
            onClick={() => setRange("1y")}
            className={`text-xs px-3 py-1 border transition-colors ${
              range === "1y"
                ? "border-accent text-accent bg-accent/5"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            1Y
          </button>
        </div>
      </div>

      {/* Price chart with MAs */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filtered} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid stroke="#E5E0DA" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#8B8680", fontSize: 10 }}
              tickFormatter={(v) => v.slice(5)}
              interval={Math.floor(filtered.length / 6)}
            />
            <YAxis
              domain={[priceMin, priceMax]}
              tick={{ fill: "#8B8680", fontSize: 10 }}
              tickFormatter={(v) => v.toFixed(0)}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: "#FFFFFF",
                border: "1px solid #E5E0DA",
                fontSize: 11,
                borderRadius: 2,
              }}
              labelStyle={{ color: "#8B8680" }}
            />
            <Line type="monotone" dataKey="close" stroke="#1A1A1A" strokeWidth={1.5} dot={false} name="Close" />
            <Line type="monotone" dataKey="ma50" stroke="#F37021" strokeWidth={1} dot={false} strokeDasharray="4 2" name="MA50" connectNulls={false} />
            <Line type="monotone" dataKey="ma200" stroke="#C0392B" strokeWidth={1} dot={false} strokeDasharray="4 2" name="MA200" connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* RSI chart */}
      <div className="h-24 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filtered} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid stroke="#E5E0DA" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#8B8680", fontSize: 10 }}
              tickFormatter={(v) => v.slice(5)}
              interval={Math.floor(filtered.length / 6)}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[30, 50, 70]}
              tick={{ fill: "#8B8680", fontSize: 10 }}
              width={50}
            />
            <ReferenceLine y={70} stroke="#C0392B" strokeDasharray="3 3" strokeWidth={0.5} />
            <ReferenceLine y={30} stroke="#2D8B4E" strokeDasharray="3 3" strokeWidth={0.5} />
            <Tooltip
              contentStyle={{
                background: "#FFFFFF",
                border: "1px solid #E5E0DA",
                fontSize: 11,
                borderRadius: 2,
              }}
              labelStyle={{ color: "#8B8680" }}
            />
            <Line type="monotone" dataKey="rsi" stroke="#F37021" strokeWidth={1} dot={false} name="RSI" connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Volume bars */}
      <div className="h-20 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={filtered} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid stroke="#E5E0DA" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#8B8680", fontSize: 10 }}
              tickFormatter={(v) => v.slice(5)}
              interval={Math.floor(filtered.length / 6)}
            />
            <YAxis
              tick={{ fill: "#8B8680", fontSize: 10 }}
              tickFormatter={(v) => {
                if (v >= 1e9) return `${(v / 1e9).toFixed(0)}B`;
                if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
                if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
                return v;
              }}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: "#FFFFFF",
                border: "1px solid #E5E0DA",
                fontSize: 11,
                borderRadius: 2,
              }}
              labelStyle={{ color: "#8B8680" }}
              formatter={(value) => [Number(value).toLocaleString(), "Volume"]}
            />
            <Bar dataKey="volume" fill="#E5E0DA" name="Volume" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary */}
      <div className="mt-4 pt-3 border-t border-border/50">
        <p className="text-[11px] text-muted leading-relaxed">{buildChartSummary(data, ticker)}</p>
      </div>
    </div>
  );
}
