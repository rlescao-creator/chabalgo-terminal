"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import SearchBar from "@/components/SearchBar";
import Rankings from "@/components/Rankings";
import Header from "@/components/Header";
import Fundamentals from "@/components/Fundamentals";
import Technicals from "@/components/Technicals";
import Charts from "@/components/Charts";
import Verdict from "@/components/Verdict";
import ShortTermVerdict from "@/components/ShortTermVerdict";
import EarningsPanel from "@/components/EarningsPanel";
import InsiderTransactions from "@/components/InsiderTransactions";
import PeerComparison from "@/components/PeerComparison";
import NewsPanel from "@/components/NewsPanel";
import CongressTrades from "@/components/CongressTrades";
import Screener from "@/components/Screener";
import CollapsibleSection from "@/components/CollapsibleSection";
import Portfolio from "@/components/Portfolio";
import { AnalysisData } from "@/lib/types";
import { fetchAnalysis } from "@/lib/api";

export default function Home() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTickerRef = useRef<string | null>(null);

  // Silent background refresh - updates data without showing loading state
  const silentRefresh = useCallback(async () => {
    const ticker = currentTickerRef.current;
    if (!ticker) return;
    try {
      const result = await fetchAnalysis(ticker);
      setData(result);
      setLastRefresh(new Date());
    } catch {
      // Silent fail on auto-refresh - don't disrupt the UI
    }
  }, []);

  // Set up auto-refresh interval when a stock is loaded
  useEffect(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    if (data && currentTickerRef.current) {
      // Refresh every 60 seconds
      refreshIntervalRef.current = setInterval(silentRefresh, 60_000);
    }
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [data, silentRefresh]);

  const handleSearch = async (ticker: string) => {
    setError("");
    setLoading(true);
    setData(null);
    currentTickerRef.current = ticker;
    try {
      const result = await fetchAnalysis(ticker);
      setData(result);
      setLastRefresh(new Date());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      currentTickerRef.current = null;
    }
    setLoading(false);
  };

  const handleClose = () => {
    setData(null);
    setError("");
    setLastRefresh(null);
    currentTickerRef.current = null;
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-background pr-8">
      {/* Header bar */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between bg-card">
        <button onClick={handleClose} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <span className="text-accent text-lg font-semibold tracking-widest uppercase">ChabAlgo</span>
          <span className="text-muted text-xs tracking-wider">Terminal</span>
        </button>
        <div className="flex items-center gap-4">
          {lastRefresh && data && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse" />
              <span>LIVE — updated {lastRefresh.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
          )}
          <div className="text-muted text-xs tracking-wide">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </div>

      {/* Search + Rankings */}
      <div className="px-6 py-8">
        <div className="flex items-start gap-3 max-w-4xl mx-auto">
          <div className="flex-1">
            <SearchBar onSearch={handleSearch} loading={loading} />
          </div>
          <Rankings onSelectTicker={handleSearch} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-6 max-w-4xl mx-auto">
          <div className="border border-red/30 bg-red/5 text-red text-sm p-4 rounded-sm">
            {error}
          </div>
        </div>
      )}

      {/* Analysis panels */}
      {data && (
        <div className="px-6 pb-10 max-w-6xl mx-auto space-y-4">
          {/* Close / back to home */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleClose}
              className="flex items-center gap-1.5 text-muted hover:text-accent transition-colors text-xs tracking-wider"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              BACK TO HOME
            </button>
            <button
              onClick={handleClose}
              className="flex items-center gap-1 text-muted hover:text-red transition-colors text-xs tracking-wider"
            >
              CLOSE
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <Header data={data} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Verdict ticker={data.ticker} />
            <ShortTermVerdict ticker={data.ticker} />
          </div>

          <NewsPanel ticker={data.ticker} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Fundamentals data={data} />
            <Technicals data={data} />
          </div>

          <Charts data={data.historical} ticker={data.ticker} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EarningsPanel ticker={data.ticker} />
            <InsiderTransactions ticker={data.ticker} />
          </div>

          <PeerComparison ticker={data.ticker} />

          <CollapsibleSection title="Congress Insider Trades" defaultOpen={false}>
            <CongressTrades ticker={data.ticker} onSelectTicker={handleSearch} />
          </CollapsibleSection>

          <CollapsibleSection title="Compounder Screener" badge="INSTITUTIONAL" defaultOpen={false}>
            <Screener onSelectTicker={handleSearch} />
          </CollapsibleSection>
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div>
          <div className="flex flex-col items-center justify-center mt-16 mb-10">
            <div className="text-accent text-4xl font-light tracking-[0.3em] uppercase mb-2">
              ChabAlgo
            </div>
            <div className="w-16 h-px bg-accent mb-4" />
            <div className="text-muted text-sm tracking-wider">
              Enter a ticker or company name to begin analysis
            </div>
          </div>
          <div className="px-6 max-w-6xl mx-auto space-y-4">
            <CollapsibleSection title="Compounder Screener" badge="INSTITUTIONAL" defaultOpen={true}>
              <Screener onSelectTicker={handleSearch} />
            </CollapsibleSection>
            <CollapsibleSection title="Congress Insider Trades" defaultOpen={true}>
              <CongressTrades onSelectTicker={handleSearch} />
            </CollapsibleSection>
          </div>
        </div>
      )}

      {/* Portfolio sidebar */}
      <Portfolio />
    </div>
  );
}
