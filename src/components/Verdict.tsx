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

interface VerdictData {
  ticker: string;
  composite_score: number;
  verdict: string;
  verdict_explanation: string;
  factors: (Factor & { has_data?: boolean })[];
  data_confidence?: number;
  data_warnings?: string[];
}

export default function Verdict({ ticker }: { ticker: string }) {
  const [data, setData] = useState<VerdictData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFactor, setExpandedFactor] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setExpandedFactor(null);
    fetch(`${API_BASE}/verdict/${ticker}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-card border border-border p-5">
        <h3 className="text-accent text-xs font-semibold tracking-wider mb-2">LONG-TERM VERDICT</h3>
        <div className="text-accent text-xs animate-pulse">Computing composite signal...</div>
      </div>
    );
  }

  if (!data) return null;

  const score = data.composite_score;

  const verdictColor = () => {
    if (score >= 70) return "text-green";
    if (score >= 55) return "text-green/70";
    if (score >= 45) return "text-yellow";
    if (score >= 30) return "text-accent";
    return "text-red";
  };

  const scoreBarColor = () => {
    if (score >= 70) return "bg-green";
    if (score >= 55) return "bg-green/60";
    if (score >= 45) return "bg-yellow";
    if (score >= 30) return "bg-accent";
    return "bg-red";
  };

  const factorSignalColor = (score: number) => {
    if (score >= 65) return "text-green";
    if (score >= 50) return "text-green/70";
    if (score >= 40) return "text-yellow";
    if (score >= 25) return "text-accent";
    return "text-red";
  };

  const factorBarColor = (score: number) => {
    if (score >= 60) return "bg-green";
    if (score >= 40) return "bg-yellow";
    return "bg-red";
  };

  const detailSignalColor = (signal: string) => {
    const s = signal.toLowerCase();
    if (["bullish", "strong", "excellent", "positive", "good", "cheap", "exceptional",
         "fortress", "consistent", "buying", "accelerating", "strong moat",
         "potential discount", "fear in the market", "fear"].includes(s)) return "text-green";
    if (["bearish", "weak", "negative", "expensive", "declining", "losing money",
         "heavy debt", "disappointing", "slowing", "avoid"].includes(s)) return "text-red";
    if (["solid", "growing", "decent"].includes(s)) return "text-green/70";
    if (["thin", "caution", "commodity", "selling", "hype", "full price"].includes(s)) return "text-accent";
    return "text-yellow";
  };

  const factorIcon = (category: string) => {
    if (category.includes("Business")) return "Q";
    if (category.includes("Growth")) return "G";
    if (category.includes("Analyst")) return "A";
    if (category.includes("Insider")) return "I";
    if (category.includes("Price")) return "P";
    return ">";
  };

  return (
    <div className="bg-card border border-accent/20 p-5">
      {/* Header: Score + Verdict */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-accent text-xs font-semibold tracking-wider mb-2">LONG-TERM VERDICT</h3>
          <div className={`text-2xl font-semibold ${verdictColor()}`}>
            {data.verdict}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-light ${verdictColor()}`}>
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
      <div className="flex justify-between text-[10px] text-muted/60 mb-5">
        <span>AVOID</span>
        <span>CAUTION</span>
        <span>HOLD/WATCH</span>
        <span>BUY</span>
        <span>STRONG BUY</span>
      </div>

      {/* Verdict explanation */}
      <div className="text-sm text-muted mb-4 leading-relaxed border-l-2 border-accent/30 pl-4">
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
      <div className="space-y-1">
        <div className="text-[10px] text-muted/60 mb-2 tracking-wider uppercase">Signal Breakdown (click to expand)</div>
        {data.factors.map((factor, fi) => (
          <div key={fi} className="border border-border rounded-sm overflow-hidden">
            <button
              onClick={() => setExpandedFactor(expandedFactor === fi ? null : fi)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-subtle transition-colors text-left"
            >
              <span className="text-accent text-xs font-semibold w-5 h-5 flex items-center justify-center border border-accent/30 rounded-sm">
                {factorIcon(factor.category)}
              </span>
              <span className="text-sm text-foreground flex-1">
                {factor.category}
                <span className="text-muted text-xs ml-1.5">({factor.weight}%)</span>
                {factor.has_data === false && (
                  <span className="text-yellow text-[9px] ml-1.5 tracking-wider">NO DATA</span>
                )}
              </span>
              <div className="flex items-center gap-3">
                <div className="w-16 h-1 bg-subtle rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${factorBarColor(factor.score)}`}
                    style={{ width: `${factor.score}%` }}
                  />
                </div>
                <span className={`text-sm font-semibold w-8 text-right ${factorSignalColor(factor.score)}`}>
                  {factor.score.toFixed(0)}
                </span>
              </div>
              <span className="text-muted text-xs">
                {expandedFactor === fi ? "-" : "+"}
              </span>
            </button>

            {expandedFactor === fi && (
              <div className="px-4 pb-4 space-y-3 border-t border-border bg-subtle/30">
                {factor.details.map((detail, di) => (
                  <div key={di} className="pt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted">{detail.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground">{detail.value}</span>
                        <span className={`text-[10px] font-semibold tracking-wider ${detailSignalColor(detail.signal)}`}>
                          {detail.signal.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-muted leading-relaxed bg-card p-3 border-l-2 border-accent/20">
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
