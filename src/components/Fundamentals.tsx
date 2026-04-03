"use client";

import { AnalysisData } from "@/lib/types";
import { formatPct, formatLargeNumber } from "@/lib/format";

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-muted text-sm">{label}</span>
      <span className={`text-sm font-medium ${color || "text-foreground"}`}>{value}</span>
    </div>
  );
}

function buildSummary(f: AnalysisData["fundamentals"], ticker: string): string {
  const parts: string[] = [];

  // Valuation
  if (f.pe_ratio != null && f.forward_pe != null) {
    if (f.forward_pe < f.pe_ratio) {
      parts.push(`${ticker} currently trades at ${f.pe_ratio.toFixed(1)}x trailing earnings. However, the forward PE drops to ${f.forward_pe.toFixed(1)}x, which tells us that Wall Street analysts are projecting meaningful earnings growth over the next 12 months. This compression between trailing and forward PE is generally a positive sign — it means the company is expected to "grow into" its valuation rather than relying on multiple expansion.`);
    } else if (f.pe_ratio > 30) {
      parts.push(`At ${f.pe_ratio.toFixed(1)}x trailing earnings (forward ${f.forward_pe.toFixed(1)}x), ${ticker} carries a premium valuation well above the S&P 500 average of roughly 20-22x. The market is pricing in sustained above-average growth. For context, stocks trading at these multiples need to consistently deliver strong earnings beats to justify their price — any disappointment could trigger a sharp correction.`);
    } else if (f.pe_ratio < 15) {
      parts.push(`${ticker} trades at just ${f.pe_ratio.toFixed(1)}x trailing earnings (forward ${f.forward_pe.toFixed(1)}x), well below the S&P 500 average of 20-22x. This could signal a genuine value opportunity if the business fundamentals are intact, or it could reflect the market pricing in declining earnings, regulatory risks, or structural challenges. The key question is whether earnings are stable or deteriorating.`);
    } else {
      parts.push(`${ticker} trades at ${f.pe_ratio.toFixed(1)}x trailing earnings with a forward PE of ${f.forward_pe.toFixed(1)}x — a fairly-valued stock by historical standards. The valuation is neither stretched nor deeply discounted, which means the stock's future performance will likely be driven more by earnings execution than by multiple expansion or compression.`);
    }
  } else if (f.pe_ratio != null) {
    parts.push(`${ticker} trades at ${f.pe_ratio.toFixed(1)}x trailing earnings. Without a forward PE estimate, it's harder to gauge whether the market expects earnings to improve or deteriorate from here.`);
  }

  // Growth
  if (f.revenue_growth_yoy != null) {
    if (f.revenue_growth_yoy > 20) {
      parts.push(`Revenue is growing at an impressive ${f.revenue_growth_yoy.toFixed(0)}% year-over-year, well above the S&P 500 average of 5-8%. This kind of top-line growth indicates strong product demand and market share gains. Companies sustaining 20%+ revenue growth are rare and typically command premium valuations because compounding at this rate can rapidly increase the intrinsic value of the business.`);
    } else if (f.revenue_growth_yoy > 10) {
      parts.push(`Revenue grew ${f.revenue_growth_yoy.toFixed(0)}% year-over-year — a solid pace that outpaces the broader market average. While not hyper-growth, this level of expansion shows the business is still gaining traction and scaling effectively. The key to watch is whether this growth rate is accelerating, stable, or decelerating quarter over quarter.`);
    } else if (f.revenue_growth_yoy > 0) {
      parts.push(`Revenue grew a modest ${f.revenue_growth_yoy.toFixed(0)}% year-over-year. While positive, this is roughly in line with GDP growth and suggests the company may be in a mature phase. For the stock to re-rate higher, management would need to demonstrate either improving growth trends or expanding margins to drive earnings upside.`);
    } else {
      parts.push(`Revenue declined ${Math.abs(f.revenue_growth_yoy).toFixed(0)}% year-over-year — a red flag that signals weakening demand, competitive pressures, or industry headwinds. Shrinking revenue makes it harder for the company to maintain margins and earnings, and often leads to multiple compression as investors demand a higher margin of safety.`);
    }
  }

  // Margins
  if (f.gross_margin != null && f.operating_margin != null) {
    const dropoff = f.gross_margin - f.operating_margin;
    if (f.gross_margin > 70 && f.operating_margin > 30) {
      parts.push(`The margin profile is exceptional: ${f.gross_margin.toFixed(0)}% gross margin and ${f.operating_margin.toFixed(0)}% operating margin. A gross margin above 70% typically indicates a business with significant pricing power, strong brand loyalty, or network effects that competitors cannot easily replicate. The ${f.operating_margin.toFixed(0)}% operating margin shows that the company is also efficient at managing its cost structure, converting a large portion of revenue into profit.`);
    } else if (f.gross_margin > 50) {
      parts.push(`Margins are healthy at ${f.gross_margin.toFixed(0)}% gross and ${f.operating_margin.toFixed(0)}% operating. The ${dropoff.toFixed(0)} percentage point gap between gross and operating margin represents sales, R&D, and administrative costs. ${dropoff > 30 ? "This gap is wide, suggesting the company invests heavily in growth (R&D, marketing) which could pay off long-term but compresses near-term profitability." : "This is a reasonable cost structure that balances investment with profitability."}`);
    } else if (f.gross_margin > 30) {
      parts.push(`Margins are moderate at ${f.gross_margin.toFixed(0)}% gross and ${f.operating_margin.toFixed(0)}% operating. This is typical of businesses that operate in competitive markets where pricing power is limited. Profitability improvements from here would likely need to come from operational efficiency or scale advantages rather than pricing.`);
    } else {
      parts.push(`Margins are thin with ${f.gross_margin.toFixed(0)}% gross and ${f.operating_margin.toFixed(0)}% operating — characteristic of a highly competitive, low-differentiation business. In this type of industry, even small shifts in costs or pricing can have an outsized impact on profitability, making earnings less predictable.`);
    }
  }

  // EPS
  if (f.eps_last_quarter != null && f.eps_surprise_pct != null) {
    if (f.eps_surprise_pct > 10) {
      parts.push(`The company reported EPS of $${f.eps_last_quarter.toFixed(2)} last quarter, beating consensus estimates by ${f.eps_surprise_pct.toFixed(1)}% — a significant upside surprise that typically signals strong underlying business momentum and potentially conservative guidance from management.`);
    } else if (f.eps_surprise_pct > 0) {
      parts.push(`Last quarter's EPS of $${f.eps_last_quarter.toFixed(2)} came in ${f.eps_surprise_pct.toFixed(1)}% above estimates — a solid beat that shows the business is executing at or above expectations.`);
    } else if (f.eps_surprise_pct < -5) {
      parts.push(`Last quarter's EPS of $${f.eps_last_quarter.toFixed(2)} missed estimates by ${Math.abs(f.eps_surprise_pct).toFixed(1)}% — a notable miss that may indicate deteriorating business conditions or unexpected cost pressures. Watch for whether management revised guidance downward.`);
    }
  }

  // Debt
  if (f.net_debt != null) {
    if (f.net_debt < 0) {
      parts.push(`The balance sheet is a source of strength: the company holds more cash than debt (net cash position of $${formatLargeNumber(Math.abs(f.net_debt))}). This provides a financial cushion for downturns, optionality for acquisitions or buybacks, and eliminates refinancing risk — a significant advantage in a higher interest rate environment.`);
    } else if (f.net_debt > 50e9) {
      parts.push(`Net debt stands at $${formatLargeNumber(f.net_debt)}, which is substantial. In the current interest rate environment, high debt levels increase financing costs and reduce financial flexibility. Investors should monitor the debt-to-EBITDA ratio and upcoming maturities to assess whether this level of leverage is manageable.`);
    } else if (f.net_debt > 0) {
      parts.push(`Net debt of $${formatLargeNumber(f.net_debt)} is present but manageable. The company uses some leverage to enhance returns, which is common and not inherently concerning as long as earnings comfortably cover interest payments.`);
    }
  }

  return parts.join(" ") || "Insufficient fundamental data available to generate a detailed summary for this stock.";
}

export default function Fundamentals({ data }: { data: AnalysisData }) {
  const f = data.fundamentals;

  if (f.source === "unavailable") {
    return (
      <div className="bg-card border border-border p-5">
        <h3 className="text-accent text-xs font-semibold tracking-wider mb-2">FUNDAMENTALS</h3>
        <span className="text-muted text-sm">Data unavailable</span>
      </div>
    );
  }

  const surpriseColor = f.eps_surprise_pct != null
    ? f.eps_surprise_pct > 0 ? "text-green" : f.eps_surprise_pct < 0 ? "text-red" : "text-yellow"
    : undefined;

  return (
    <div className="bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-accent text-xs font-semibold tracking-wider">FUNDAMENTALS</h3>
        <span className="text-muted/40 text-[10px]">[{f.source}]</span>
      </div>
      <div>
        <Row label="PE Ratio (TTM)" value={f.pe_ratio != null ? f.pe_ratio.toFixed(1) : "--"} />
        <Row label="Forward PE" value={f.forward_pe != null ? f.forward_pe.toFixed(1) : "--"} />
        <Row
          label="Revenue Growth YoY"
          value={f.revenue_growth_yoy != null ? formatPct(f.revenue_growth_yoy) : "--"}
          color={f.revenue_growth_yoy != null ? (f.revenue_growth_yoy > 0 ? "text-green" : "text-red") : undefined}
        />
        <Row label="Gross Margin" value={f.gross_margin != null ? `${f.gross_margin.toFixed(1)}%` : "--"} />
        <Row label="Operating Margin" value={f.operating_margin != null ? `${f.operating_margin.toFixed(1)}%` : "--"} />
        <Row label="EPS (Last Q)" value={f.eps_last_quarter != null ? f.eps_last_quarter.toFixed(2) : "--"} />
        {f.eps_estimate != null && (
          <Row label="EPS Estimate" value={f.eps_estimate.toFixed(2)} />
        )}
        {f.eps_surprise_pct != null && (
          <Row label="EPS Surprise" value={formatPct(f.eps_surprise_pct)} color={surpriseColor} />
        )}
        <Row
          label="Net Debt"
          value={f.net_debt != null ? formatLargeNumber(f.net_debt) : "--"}
          color={f.net_debt != null ? (f.net_debt > 0 ? "text-red" : "text-green") : undefined}
        />
      </div>
      <div className="mt-3 pt-3 border-t border-border/50">
        <p className="text-[11px] text-muted leading-relaxed">{buildSummary(f, data.ticker)}</p>
      </div>
    </div>
  );
}
