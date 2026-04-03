"use client";

import { AnalysisData } from "@/lib/types";
import { formatPrice, colorForSignal } from "@/lib/format";

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-muted text-sm">{label}</span>
      <span className={`text-sm font-medium ${color || "text-foreground"}`}>{value}</span>
    </div>
  );
}

function buildSummary(t: AnalysisData["technicals"], price: number, ticker: string): string {
  const parts: string[] = [];

  // MA positioning
  if (t.ma50 != null && t.ma200 != null) {
    const pctFromMa50 = ((price - t.ma50) / t.ma50 * 100);
    const pctFromMa200 = ((price - t.ma200) / t.ma200 * 100);

    if (t.price_vs_ma50 === "below" && t.price_vs_ma200 === "below") {
      parts.push(`${ticker} is currently trading ${Math.abs(pctFromMa50).toFixed(1)}% below its 50-day moving average ($${t.ma50.toFixed(2)}) and ${Math.abs(pctFromMa200).toFixed(1)}% below its 200-day moving average ($${t.ma200.toFixed(2)}). This is a bearish technical configuration — when a stock trades below both key moving averages, it signals sustained selling pressure and a lack of institutional buying support. Historically, stocks in this position tend to remain under pressure until a catalyst (earnings beat, macro shift, or sector rotation) reverses the trend.`);
      if (t.ma50 < t.ma200) {
        parts.push(`Additionally, the 50-day MA has crossed below the 200-day MA — known as a "death cross" — which is a classic bearish signal that often precedes further downside or an extended period of underperformance.`);
      }
    } else if (t.price_vs_ma50 === "above" && t.price_vs_ma200 === "above") {
      parts.push(`${ticker} is trading in a technically strong position: ${pctFromMa50.toFixed(1)}% above its 50-day moving average ($${t.ma50.toFixed(2)}) and ${pctFromMa200.toFixed(1)}% above its 200-day moving average ($${t.ma200.toFixed(2)}). When a stock holds above both key averages, it confirms that both short-term and long-term trends are bullish, with institutional buyers actively supporting the price on dips.`);
      if (t.ma50 > t.ma200) {
        parts.push(`The 50-day MA is also above the 200-day MA (a "golden cross" structure), reinforcing the bullish trend. The MA50 at $${t.ma50.toFixed(2)} acts as the first level of support on any pullback.`);
      }
    } else if (t.price_vs_ma50 === "below" && t.price_vs_ma200 === "above") {
      parts.push(`${ticker} has recently dipped ${Math.abs(pctFromMa50).toFixed(1)}% below its 50-day moving average ($${t.ma50.toFixed(2)}) but still holds ${pctFromMa200.toFixed(1)}% above the 200-day average ($${t.ma200.toFixed(2)}). This is a common pattern during healthy pullbacks within a longer-term uptrend — the stock is correcting short-term but the broader trend remains intact. The MA200 at $${t.ma200.toFixed(2)} is the critical support level to watch — a break below it would signal a potential trend reversal.`);
    } else {
      parts.push(`${ticker} shows a mixed technical picture: it has bounced above its 50-day MA ($${t.ma50.toFixed(2)}) but remains below the 200-day MA ($${t.ma200.toFixed(2)}). This suggests a short-term recovery attempt within a broader downtrend. For the technical picture to turn fully bullish, the stock would need to reclaim and hold above the 200-day average at $${t.ma200.toFixed(2)}, which often acts as heavy resistance.`);
    }
  }

  // RSI
  if (t.rsi != null) {
    if (t.rsi < 30) {
      parts.push(`The RSI (Relative Strength Index) reads ${t.rsi.toFixed(1)}, which places ${ticker} in deeply oversold territory. RSI below 30 indicates extreme selling pressure — historically, stocks tend to bounce from these levels within 1-2 weeks as bargain hunters and institutions step in. However, oversold does not mean "guaranteed bounce" — in strong downtrends, RSI can remain oversold for extended periods. Look for RSI to climb back above 30 as confirmation of a reversal.`);
    } else if (t.rsi < 40) {
      parts.push(`RSI at ${t.rsi.toFixed(1)} indicates weak momentum that is approaching oversold levels. While not yet at the extreme (below 30) where sharp bounces are most common, the stock is getting close to a zone where selling pressure typically begins to exhaust itself. If you're looking for an entry point, waiting for RSI to dip below 30 or for it to start turning upward from current levels would provide a higher-probability setup.`);
    } else if (t.rsi > 70) {
      parts.push(`RSI at ${t.rsi.toFixed(1)} signals overbought conditions — the stock has risen too quickly and may be due for a short-term pullback or consolidation. When RSI exceeds 70, it means buying momentum is stretched, and profit-taking often follows. This doesn't mean the stock will crash — strong stocks can remain overbought for weeks during powerful rallies — but it does mean the risk/reward for new entries at this level is less favorable. Consider waiting for a pullback to the MA50 for a better entry.`);
    } else if (t.rsi > 60) {
      parts.push(`RSI at ${t.rsi.toFixed(1)} reflects healthy upward momentum without being overextended. The stock is trending higher with room to run before reaching overbought levels (70+). This is often the "sweet spot" for momentum investors — the trend is clearly bullish but hasn't yet reached the point where a reversal becomes likely.`);
    } else {
      parts.push(`RSI at ${t.rsi.toFixed(1)} sits in neutral territory, indicating no clear momentum bias in either direction. The stock is neither oversold (where bounces are likely) nor overbought (where pullbacks are likely). Price action from here will depend on upcoming catalysts — earnings, macro data, or sector rotation — rather than technical momentum.`);
    }
  }

  return parts.join(" ") || "Insufficient technical data available to generate a detailed analysis.";
}

export default function Technicals({ data }: { data: AnalysisData }) {
  const t = data.technicals;

  if (t.source === "unavailable") {
    return (
      <div className="bg-card border border-border p-5">
        <h3 className="text-accent text-xs font-semibold tracking-wider mb-2">TECHNICALS</h3>
        <span className="text-muted text-sm">Data unavailable</span>
      </div>
    );
  }

  const signalColor = colorForSignal(t.signal);

  return (
    <div className="bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-accent text-xs font-semibold tracking-wider">TECHNICALS</h3>
        <span className="text-muted/40 text-[10px]">[{t.source}]</span>
      </div>
      <div>
        <Row
          label="MA50"
          value={t.ma50 != null ? `${formatPrice(t.ma50)} (${t.price_vs_ma50})` : "--"}
          color={colorForSignal(t.price_vs_ma50)}
        />
        <Row
          label="MA200"
          value={t.ma200 != null ? `${formatPrice(t.ma200)} (${t.price_vs_ma200})` : "--"}
          color={colorForSignal(t.price_vs_ma200)}
        />
        <Row
          label="RSI (14)"
          value={t.rsi != null ? `${t.rsi.toFixed(1)} (${t.rsi_signal})` : "--"}
          color={colorForSignal(t.rsi_signal)}
        />
        <div className="border-t border-border mt-2 pt-2">
          <div className="flex justify-between">
            <span className="text-muted text-sm">Signal</span>
            <span className={`text-sm font-semibold ${signalColor}`}>{t.signal}</span>
          </div>
          {t.signal_reason && (
            <div className="text-muted/60 text-xs text-right mt-1">{t.signal_reason}</div>
          )}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-border/50">
        <p className="text-[11px] text-muted leading-relaxed">{buildSummary(t, data.price.price, data.ticker)}</p>
      </div>
    </div>
  );
}
