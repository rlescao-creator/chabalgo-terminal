export interface AnalysisData {
  ticker: string;
  profile: {
    name: string;
    market_cap: number;
    industry: string;
    exchange: string;
    source: string;
  };
  price: {
    price: number;
    change: number;
    change_percent: number;
    high: number;
    low: number;
    open: number;
    prev_close: number;
    currency?: string;
    source: string;
  };
  fundamentals: {
    pe_ratio: number | null;
    forward_pe: number | null;
    revenue_growth_yoy: number | null;
    gross_margin: number | null;
    operating_margin: number | null;
    eps_last_quarter: number | null;
    eps_estimate: number | null;
    eps_surprise_pct: number | null;
    net_debt: number | null;
    source: string;
  };
  technicals: {
    ma50: number | null;
    ma200: number | null;
    price_vs_ma50: string | null;
    price_vs_ma200: string | null;
    rsi: number | null;
    rsi_signal: string | null;
    signal: string | null;
    signal_reason: string | null;
    source: string;
  };
  historical: HistoricalPoint[];
  news: NewsItem[];
  sentiment: {
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
  };
}

export interface HistoricalPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma50?: number;
  ma200?: number;
  rsi?: number;
}

export interface NewsItem {
  headline: string;
  source: string;
  url: string;
  datetime: number;
  summary: string;
}

export interface PortfolioPosition {
  ticker: string;
  shares: number;
  avg_price: number;
  current_price?: number;
  value?: number;
  cost?: number;
  pnl?: number;
  pnl_pct?: number;
  allocation_pct?: number;
}

export interface PortfolioPnL {
  positions: PortfolioPosition[];
  total_value: number;
  total_cost: number;
  total_pnl: number;
  total_pnl_pct: number;
}
