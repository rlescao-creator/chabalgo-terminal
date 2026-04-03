"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FactorDetail {
  name: string;
  value: string;
  signal: string;
  explanation: string;
}

interface Factor {
  category: string;
  score: number;
  weight: number;
  details: FactorDetail[];
}

interface ShortTermData {
  ticker: string;
  composite_score: number;
  verdict: string;
  verdict_explanation: string;
  factors: (Factor & { has_data?: boolean })[];
  data_confidence?: number;
  data_warnings?: string[];
}

export default function ShortTermVerdict({ ticker }: { ticker: string }) {
  const [data, setData] = useState<ShortTermData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFactor, setExpandedFactor] = useState<number | null>(null);
  useEffect(() => {
    setLoading(true);
    setExpandedFactor(null);
    fetch(`${API_BASE}/short-term/${ticker}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-card border border-border p-5">
        <h3 className="text-xs font-semibold tracking-wider mb-2" style={{ color: "#2D8B4E" }}>SHORT-TERM SIGNAL</h3>
        <div className="text-muted text-xs animate-pulse">Analyzing momentum & catalysts...</div>
      </div>
    );
  }

  if (!data) return null;

  const score = data.composite_score;

  const verdictColor = () => {
    if (score >= 65) return "text-green";
    if (score >= 50) return "text-green/70";
    if (score >= 40) return "text-yellow";
    if (score >= 30) return "text-accent";
    return "text-red";
  };

  const scoreBarColor = () => {
    if (score >= 65) return "bg-green";
    if (score >= 50) return "bg-green/60";
    if (score >= 40) return "bg-yellow";
    if (score >= 30) return "bg-accent";
    return "bg-red";
  };

  const factorColor = (s: number) => {
    if (s >= 60) return "text-green";
    if (s >= 45) return "text-yellow";
    return "text-red";
  };

  const factorBarColor = (s: number) => {
    if (s >= 60) return "bg-green";
    if (s >= 40) return "bg-yellow";
    return "bg-red";
  };

  const detailSignalColor = (signal: string) => {
    const s = signal.toLowerCase();
    if (["strong rally", "positive", "bullish structure", "buying frenzy",
         "extremely oversold", "oversold", "strong consensus buy", "majority buy",
         "active coverage", "strong uptrend", "uptrend", "recovery"].includes(s)) return "text-green";
    if (["selloff", "bearish structure", "panic selling", "overbought",
         "majority sell", "strong downtrend", "downtrend", "weakening"].includes(s)) return "text-red";
    return "text-yellow";
  };

  const factorIcon = (category: string) => {
    if (category.includes("Momentum")) return "M";
    if (category.includes("Technical")) return "T";
    if (category.includes("Volume")) return "V";
    if (category.includes("News")) return "N";
    if (category.includes("Analyst")) return "A";
    return ">";
  };


  return (
    <div className="bg-card border border-border p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold tracking-wider mb-2" style={{ color: "#2D8B4E" }}>SHORT-TERM SIGNAL</h3>
          <div className={`text-xl font-semibold ${verdictColor()}`}>
            {data.verdict}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-light ${verdictColor()}`}>
            {score.toFixed(0)}
          </div>
          <div className="text-xs text-muted">/ 100</div>
        </div>
      </div>

      {/* Score bar */}
      <div className="relative w-full h-1.5 bg-subtle mb-1 rounded-full overflow-hidden">
        <div
          className={`h-full ${scoreBarColor()} transition-all duration-500 rounded-full`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted/60 mb-4">
        <span>SELL</span>
        <span>BEARISH</span>
        <span>NEUTRAL</span>
        <span>BULLISH</span>
        <span>BUY</span>
      </div>

      {/* Explanation */}
      <div className="text-sm text-muted mb-4 leading-relaxed border-l-2 pl-4" style={{ borderColor: "#2D8B4E40" }}>
        {data.verdict_explanation}
      </div>

      {/* Data confidence warning */}
      {data.data_confidence != null && data.data_confidence < 100 && data.data_warnings && data.data_warnings.length > 0 && (
        <div className="mb-4 border border-yellow/30 bg-yellow/5 p-3 rounded-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow text-xs font-semibold">DATA CONFIDENCE: {data.data_confidence}%</span>
          </div>
          <div className="text-xs text-muted leading-relaxed">
            {data.data_warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        </div>
      )}

      {/* Factor breakdown */}
      <div className="space-y-1 mb-5">
        <div className="text-[10px] text-muted/60 mb-2 tracking-wider uppercase">Signal Breakdown</div>
        {data.factors.map((factor, fi) => (
          <div key={fi} className="border border-border rounded-sm overflow-hidden">
            <button
              onClick={() => setExpandedFactor(expandedFactor === fi ? null : fi)}
              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-subtle transition-colors text-left"
            >
              <span className="text-xs font-semibold w-5 h-5 flex items-center justify-center border rounded-sm" style={{ color: "#2D8B4E", borderColor: "#2D8B4E40" }}>
                {factorIcon(factor.category)}
              </span>
              <span className="text-sm text-foreground flex-1">
                {factor.category}
                <span className="text-muted text-xs ml-1.5">({factor.weight}%)</span>
              </span>
              <div className="flex items-center gap-3">
                <div className="w-16 h-1 bg-subtle rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${factorBarColor(factor.score)}`}
                    style={{ width: `${factor.score}%` }}
                  />
                </div>
                <span className={`text-sm font-semibold w-8 text-right ${factorColor(factor.score)}`}>
                  {factor.score.toFixed(0)}
                </span>
              </div>
              <span className="text-muted text-xs">{expandedFactor === fi ? "-" : "+"}</span>
            </button>

            {expandedFactor === fi && (
              <div className="px-4 pb-3 space-y-2 border-t border-border bg-subtle/30">
                {factor.details.map((detail, di) => (
                  <div key={di} className="pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted">{detail.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground">{detail.value}</span>
                        <span className={`text-[10px] font-semibold tracking-wider ${detailSignalColor(detail.signal)}`}>
                          {detail.signal.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-muted leading-relaxed bg-card p-2.5 border-l-2" style={{ borderColor: "#2D8B4E30" }}>
                      {detail.explanation}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
