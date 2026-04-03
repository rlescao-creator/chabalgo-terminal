"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface SearchResult {
  symbol: string;
  description: string;
  type: string;
}

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading: boolean;
}

export default function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      setSuggestions(data.results || []);
      setShowSuggestions((data.results || []).length > 0);
      setSelectedIdx(-1);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(v.trim());
    }, 250);
  };

  const submitTicker = (ticker: string) => {
    setValue(ticker);
    setShowSuggestions(false);
    setSuggestions([]);
    onSearch(ticker);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
      submitTicker(suggestions[selectedIdx].symbol);
      return;
    }
    setShowSuggestions(false);
    onSearch(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={containerRef} className="w-full max-w-2xl mx-auto relative">
      <form onSubmit={handleSubmit}>
        <div className="border border-border bg-card flex items-center px-5 py-3.5 shadow-sm hover:border-accent/40 transition-colors focus-within:border-accent/60">
          <svg className="w-4 h-4 text-accent mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder='Search ticker or company name...'
            className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted/60"
            disabled={loading}
          />
          {loading && (
            <span className="text-accent text-xs animate-pulse ml-2 tracking-wider">LOADING</span>
          )}
        </div>
      </form>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 border border-border border-t-0 bg-card shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((item, i) => (
            <button
              key={`${item.symbol}-${i}`}
              type="button"
              className={`w-full text-left px-5 py-2.5 flex items-center gap-3 text-sm transition-colors ${
                i === selectedIdx ? "bg-accent-light text-accent" : "text-foreground hover:bg-subtle"
              }`}
              onClick={() => submitTicker(item.symbol)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="text-accent font-semibold min-w-[60px]">{item.symbol}</span>
              <span className="text-muted truncate">{item.description}</span>
              <span className="text-muted/50 ml-auto text-xs">{item.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
