import os
import json
import datetime
import threading
import time as _time
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="ChabAlgo Terminal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")
ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY", "")

# In-memory portfolio store
portfolio: Dict[str, Dict[str, Any]] = {}


class PortfolioPosition(BaseModel):
    ticker: str
    shares: float
    avg_price: float


# --- Helper functions ---

def finnhub_get(endpoint: str, params: dict = None) -> Optional[dict]:
    if not FINNHUB_API_KEY:
        return None
    try:
        base = "https://finnhub.io/api/v1"
        p = {"token": FINNHUB_API_KEY}
        if params:
            p.update(params)
        r = requests.get(f"{base}/{endpoint}", params=p, timeout=10)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def alpha_vantage_get(function: str, symbol: str, extra: dict = None) -> Optional[dict]:
    if not ALPHA_VANTAGE_API_KEY:
        return None
    try:
        params = {
            "function": function,
            "symbol": symbol,
            "apikey": ALPHA_VANTAGE_API_KEY,
        }
        if extra:
            params.update(extra)
        r = requests.get("https://www.alphavantage.co/query", params=params, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if "Error Message" in data or "Note" in data:
                return None
            return data
    except Exception:
        pass
    return None


def get_realtime_price(ticker: str) -> dict:
    """Get real-time price. Finnhub first, yfinance fallback."""
    # Try Finnhub
    data = finnhub_get("quote", {"symbol": ticker})
    if data and data.get("c") and data["c"] > 0:
        return {
            "price": round(data["c"], 2),
            "change": round(data["d"], 2) if data.get("d") else 0,
            "change_percent": round(data["dp"], 2) if data.get("dp") else 0,
            "high": round(data.get("h", 0), 2),
            "low": round(data.get("l", 0), 2),
            "open": round(data.get("o", 0), 2),
            "prev_close": round(data.get("pc", 0), 2),
            "currency": "USD",
            "source": "finnhub",
        }

    # Fallback: yfinance
    try:
        t = yf.Ticker(ticker)
        info = t.info
        price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
        if price:
            prev = info.get("previousClose", price)
            change = round(price - prev, 2)
            change_pct = round((change / prev) * 100, 2) if prev else 0
            currency = info.get("currency", "USD")
            return {
                "price": round(price, 2),
                "change": change,
                "change_percent": change_pct,
                "high": round(info.get("dayHigh", 0) or 0, 2),
                "low": round(info.get("dayLow", 0) or 0, 2),
                "open": round(info.get("open", 0) or 0, 2),
                "prev_close": round(prev, 2),
                "currency": currency,
                "source": "yfinance",
            }
    except Exception:
        pass

    return {}


def get_company_profile(ticker: str) -> dict:
    """Get company name, market cap, etc."""
    # Finnhub profile
    data = finnhub_get("stock/profile2", {"symbol": ticker})
    if data and data.get("name"):
        return {
            "name": data.get("name", ""),
            "market_cap": data.get("marketCapitalization", 0) * 1e6 if data.get("marketCapitalization") else 0,
            "industry": data.get("finnhubIndustry", ""),
            "exchange": data.get("exchange", ""),
            "logo": data.get("logo", ""),
            "source": "finnhub",
        }

    # Fallback: yfinance
    try:
        t = yf.Ticker(ticker)
        info = t.info
        return {
            "name": info.get("longName") or info.get("shortName", ""),
            "market_cap": info.get("marketCap", 0) or 0,
            "industry": info.get("industry", ""),
            "exchange": info.get("exchange", ""),
            "logo": "",
            "source": "yfinance",
        }
    except Exception:
        pass
    return {}


def get_fundamentals(ticker: str) -> dict:
    """Get fundamentals from Alpha Vantage, yfinance fallback."""
    result = {
        "pe_ratio": None,
        "forward_pe": None,
        "revenue_growth_yoy": None,
        "gross_margin": None,
        "operating_margin": None,
        "eps_last_quarter": None,
        "eps_estimate": None,
        "eps_surprise_pct": None,
        "net_debt": None,
        "source": "unavailable",
    }

    # Try Alpha Vantage overview
    overview = alpha_vantage_get("OVERVIEW", ticker)
    if overview and overview.get("Symbol"):
        result["source"] = "alpha_vantage"
        result["pe_ratio"] = _safe_float(overview.get("TrailingPE"))
        result["forward_pe"] = _safe_float(overview.get("ForwardPE"))
        result["revenue_growth_yoy"] = _safe_float(overview.get("QuarterlyRevenueGrowthYOY"))
        result["gross_margin"] = _safe_float(overview.get("GrossProfitTTM"))  # will compute ratio below
        result["operating_margin"] = _safe_float(overview.get("OperatingMarginTTM"))
        result["eps_last_quarter"] = _safe_float(overview.get("EPS"))

        # Compute gross margin as ratio if we have revenue
        revenue_ttm = _safe_float(overview.get("RevenueTTM"))
        gross_profit_ttm = _safe_float(overview.get("GrossProfitTTM"))
        if revenue_ttm and gross_profit_ttm:
            result["gross_margin"] = round(gross_profit_ttm / revenue_ttm * 100, 1)

        # Try earnings for surprise
        earnings = alpha_vantage_get("EARNINGS", ticker)
        if earnings and earnings.get("quarterlyEarnings"):
            latest = earnings["quarterlyEarnings"][0]
            result["eps_last_quarter"] = _safe_float(latest.get("reportedEPS"))
            result["eps_estimate"] = _safe_float(latest.get("estimatedEPS"))
            if result["eps_last_quarter"] is not None and result["eps_estimate"] is not None and result["eps_estimate"] != 0:
                result["eps_surprise_pct"] = round(
                    ((result["eps_last_quarter"] - result["eps_estimate"]) / abs(result["eps_estimate"])) * 100, 1
                )

        # Net debt from balance sheet
        bs = alpha_vantage_get("BALANCE_SHEET", ticker)
        if bs and bs.get("quarterlyReports"):
            latest_bs = bs["quarterlyReports"][0]
            total_debt = _safe_float(latest_bs.get("shortLongTermDebtTotal")) or (
                (_safe_float(latest_bs.get("shortTermDebt")) or 0) +
                (_safe_float(latest_bs.get("longTermDebt")) or 0)
            )
            cash = _safe_float(latest_bs.get("cashAndCashEquivalentsAtCarryingValue")) or \
                   _safe_float(latest_bs.get("cashAndShortTermInvestments")) or 0
            if total_debt is not None:
                result["net_debt"] = round(total_debt - cash, 0)

        return result

    # Fallback: yfinance
    try:
        t = yf.Ticker(ticker)
        info = t.info
        result["source"] = "yfinance"
        result["pe_ratio"] = _safe_float(info.get("trailingPE"))
        result["forward_pe"] = _safe_float(info.get("forwardPE"))
        result["revenue_growth_yoy"] = _pct(info.get("revenueGrowth"))
        result["gross_margin"] = _pct(info.get("grossMargins"))
        result["operating_margin"] = _pct(info.get("operatingMargins"))

        # EPS
        result["eps_last_quarter"] = _safe_float(info.get("trailingEps"))

        # Net debt
        total_debt = info.get("totalDebt", 0) or 0
        total_cash = info.get("totalCash", 0) or 0
        if total_debt or total_cash:
            result["net_debt"] = round(total_debt - total_cash, 0)
    except Exception:
        pass

    return result


def get_technicals(ticker: str) -> dict:
    """Compute MA50, MA200, RSI from yfinance historical data."""
    result = {
        "ma50": None,
        "ma200": None,
        "price_vs_ma50": None,
        "price_vs_ma200": None,
        "rsi": None,
        "rsi_signal": None,
        "signal": None,
        "signal_reason": None,
        "source": "unavailable",
    }

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="1y")
        if hist.empty or len(hist) < 14:
            return result

        closes = hist["Close"].values
        current_price = closes[-1]

        # MA50
        if len(closes) >= 50:
            ma50 = float(np.mean(closes[-50:]))
            result["ma50"] = round(ma50, 2)
            result["price_vs_ma50"] = "above" if current_price > ma50 else "below"

        # MA200
        if len(closes) >= 200:
            ma200 = float(np.mean(closes[-200:]))
            result["ma200"] = round(ma200, 2)
            result["price_vs_ma200"] = "above" if current_price > ma200 else "below"

        # RSI (Wilder's smoothing)
        rsi_val = compute_rsi(closes, period=14)
        if rsi_val is not None:
            result["rsi"] = round(rsi_val, 1)
            if rsi_val < 35:
                result["rsi_signal"] = "oversold"
            elif rsi_val > 65:
                result["rsi_signal"] = "overbought"
            else:
                result["rsi_signal"] = "neutral"

        # Overall signal
        bullish_count = 0
        bearish_count = 0

        if result["price_vs_ma50"] == "above":
            bullish_count += 1
        elif result["price_vs_ma50"] == "below":
            bearish_count += 1

        if result["price_vs_ma200"] == "above":
            bullish_count += 1
        elif result["price_vs_ma200"] == "below":
            bearish_count += 1

        if result["rsi_signal"] == "oversold":
            bullish_count += 1  # contrarian
        elif result["rsi_signal"] == "overbought":
            bearish_count += 1

        if bullish_count > bearish_count:
            result["signal"] = "Bullish"
            reasons = []
            if result["price_vs_ma50"] == "above":
                reasons.append("above MA50")
            if result["price_vs_ma200"] == "above":
                reasons.append("above MA200")
            if result["rsi_signal"] == "oversold":
                reasons.append("RSI oversold (reversal)")
            result["signal_reason"] = ", ".join(reasons)
        elif bearish_count > bullish_count:
            result["signal"] = "Bearish"
            reasons = []
            if result["price_vs_ma50"] == "below":
                reasons.append("below MA50")
            if result["price_vs_ma200"] == "below":
                reasons.append("below MA200")
            if result["rsi_signal"] == "overbought":
                reasons.append("RSI overbought")
            result["signal_reason"] = ", ".join(reasons)
        else:
            result["signal"] = "Neutral"
            result["signal_reason"] = "mixed signals"

        result["source"] = "yfinance"
    except Exception:
        pass

    return result


def compute_rsi(closes: np.ndarray, period: int = 14) -> Optional[float]:
    """Compute RSI using Wilder's smoothing method."""
    if len(closes) < period + 1:
        return None

    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    # Initial average
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])

    # Wilder's smoothing
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return float(rsi)


def get_historical_data(ticker: str, period: str = "1y") -> list:
    """Get OHLCV data from yfinance."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period=period)
        if hist.empty:
            return []

        closes = hist["Close"].values
        records = []
        for i, (date, row) in enumerate(hist.iterrows()):
            entry = {
                "date": date.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }

            # Compute MA50 and MA200 at each point
            idx = i + 1
            if idx >= 50:
                entry["ma50"] = round(float(np.mean(closes[idx - 50:idx])), 2)
            if idx >= 200:
                entry["ma200"] = round(float(np.mean(closes[idx - 200:idx])), 2)

            # Compute RSI at each point (need at least period+1 data points)
            if idx >= 15:
                rsi_val = compute_rsi(closes[:idx], period=14)
                if rsi_val is not None:
                    entry["rsi"] = round(rsi_val, 1)

            records.append(entry)

        return records
    except Exception:
        return []


def get_news(ticker: str) -> list:
    """Get news from Finnhub."""
    now = datetime.datetime.now()
    from_date = (now - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
    to_date = now.strftime("%Y-%m-%d")

    data = finnhub_get("company-news", {
        "symbol": ticker,
        "from": from_date,
        "to": to_date,
    })

    if not data or not isinstance(data, list):
        return []

    news = []
    for item in data[:5]:
        news.append({
            "headline": item.get("headline", ""),
            "source": item.get("source", ""),
            "url": item.get("url", ""),
            "datetime": item.get("datetime", 0),
            "summary": item.get("summary", ""),
        })

    return news


def get_sentiment(ticker: str) -> dict:
    """Get analyst recommendation sentiment from Finnhub."""
    data = finnhub_get("stock/recommendation", {"symbol": ticker})
    if data and isinstance(data, list) and len(data) > 0:
        latest = data[0]
        strong_buy = latest.get("strongBuy", 0)
        buy = latest.get("buy", 0)
        hold = latest.get("hold", 0)
        sell = latest.get("sell", 0)
        strong_sell = latest.get("strongSell", 0)
        total = strong_buy + buy + hold + sell + strong_sell

        if total == 0:
            return {"score": 0.5, "label": "Neutral", "analysts_total": 0,
                    "strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0,
                    "period": "", "source": "unavailable"}

        # Weighted score: strongBuy=1.0, buy=0.75, hold=0.5, sell=0.25, strongSell=0.0
        score = (strong_buy * 1.0 + buy * 0.75 + hold * 0.5 + sell * 0.25 + strong_sell * 0.0) / total

        if score >= 0.7:
            label = "Bullish"
        elif score <= 0.4:
            label = "Bearish"
        else:
            label = "Neutral"

        return {
            "score": round(score, 2),
            "label": label,
            "analysts_total": total,
            "strong_buy": strong_buy,
            "buy": buy,
            "hold": hold,
            "sell": sell,
            "strong_sell": strong_sell,
            "period": latest.get("period", ""),
            "source": "finnhub",
        }
    return {"score": 0.5, "label": "Neutral", "analysts_total": 0,
            "strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0,
            "period": "", "source": "unavailable"}


def _safe_float(val) -> Optional[float]:
    if val is None or val == "None" or val == "-":
        return None
    try:
        return round(float(val), 2)
    except (ValueError, TypeError):
        return None


def _pct(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return round(float(val) * 100, 1)
    except (ValueError, TypeError):
        return None


# PEA-eligible European stocks (name -> yfinance ticker)
# Covers: France (.PA), Germany (.DE), Netherlands (.AS), Italy (.MI),
#          Spain (.MC), Belgium (.BR), Finland (.HE), Ireland (.IR/.L), Portugal (.LS)
EU_STOCK_MAP = {
    # ========== FRANCE (.PA) - CAC 40 + Mid/Small ==========
    # CAC 40
    "lvmh": "MC.PA", "mc": "MC.PA",
    "hermes": "RMS.PA", "rms": "RMS.PA", "hermès": "RMS.PA",
    "total": "TTE.PA", "totalenergies": "TTE.PA", "tte": "TTE.PA",
    "airbus": "AIR.PA", "air": "AIR.PA",
    "sanofi": "SAN.PA", "san": "SAN.PA",
    "loreal": "OR.PA", "l'oreal": "OR.PA", "l'oréal": "OR.PA",
    "schneider": "SU.PA", "schneider electric": "SU.PA",
    "dassault systemes": "DSY.PA", "dsy": "DSY.PA",
    "safran": "SAF.PA", "saf": "SAF.PA",
    "bnp": "BNP.PA", "bnp paribas": "BNP.PA",
    "axa": "CS.PA", "cs": "CS.PA",
    "vinci": "DG.PA", "dg": "DG.PA",
    "kering": "KER.PA", "ker": "KER.PA",
    "danone": "BN.PA", "bn": "BN.PA",
    "pernod": "RI.PA", "pernod ricard": "RI.PA", "ri": "RI.PA",
    "stmicroelectronics": "STM.PA", "stm": "STM.PA", "stmicro": "STM.PA",
    "capgemini": "CAP.PA", "cap": "CAP.PA",
    "engie": "ENGI.PA", "engi": "ENGI.PA",
    "orange": "ORA.PA", "ora": "ORA.PA",
    "societe generale": "GLE.PA", "gle": "GLE.PA", "socgen": "GLE.PA",
    "credit agricole": "ACA.PA", "aca": "ACA.PA",
    "renault": "RNO.PA", "rno": "RNO.PA",
    "veolia": "VIE.PA", "vie": "VIE.PA",
    "bouygues": "EN.PA", "en": "EN.PA",
    "thales": "HO.PA", "ho": "HO.PA",
    "michelin": "ML.PA", "ml": "ML.PA",
    "saint gobain": "SGO.PA", "sgo": "SGO.PA", "saint-gobain": "SGO.PA",
    "legrand": "LR.PA", "lr": "LR.PA",
    "publicis": "PUB.PA", "pub": "PUB.PA",
    "teleperformance": "TEP.PA", "tep": "TEP.PA",
    "essilor": "EL.PA", "essilorluxottica": "EL.PA", "el": "EL.PA",
    "vivendi": "VIV.PA", "viv": "VIV.PA",
    "eurofins": "ERF.PA", "erf": "ERF.PA",
    "worldline": "WLN.PA", "wln": "WLN.PA",
    "stellantis": "STLAP.PA", "stla": "STLAP.PA",
    "alstom": "ALO.PA", "alo": "ALO.PA",
    # Mid & Small caps FR
    "soitec": "SOI.PA", "soi": "SOI.PA",
    "exail": "EXA.PA", "exail technologies": "EXA.PA", "exa": "EXA.PA",
    "exosens": "EXENS.PA", "exens": "EXENS.PA",
    "2crsi": "2CRSI.PA",
    "ovh": "OVH.PA", "ovhcloud": "OVH.PA", "ovh cloud": "OVH.PA",
    "ovalto": "OVH.PA",
    "dassault aviation": "AM.PA",
    "atos": "ATO.PA",
    "kalray": "ALKAL.PA", "alkal": "ALKAL.PA",
    "believe": "BLV.PA", "blv": "BLV.PA",
    "solutions 30": "S30.PA", "s30": "S30.PA",
    "navya": "NAVYA.PA",
    "wallix": "ALLIX.PA", "allix": "ALLIX.PA",
    "verimatrix": "VMX.PA", "vmx": "VMX.PA",
    "drone volt": "ALDRV.PA", "aldrv": "ALDRV.PA",
    "theranexus": "ALTHX.PA", "althx": "ALTHX.PA",
    "forsee power": "FORSE.PA", "forse": "FORSE.PA",
    "lacroix": "LACR.PA", "lacr": "LACR.PA",
    "lumibird": "LBIRD.PA", "lbird": "LBIRD.PA",
    "mersen": "MRN.PA", "mrn": "MRN.PA",
    "ateme": "ATEME.PA",
    "streamwide": "ALSTW.PA", "alstw": "ALSTW.PA",
    "planisware": "PLNW.PA", "plnw": "PLANISWARE.PA",
    "dassault aviation": "AM.PA", "am": "AM.PA",
    "biomerieux": "BIM.PA", "bim": "BIM.PA",
    "sartorius stedim": "DIM.PA", "dim": "DIM.PA",
    "edenred": "EDEN.PA", "eden": "EDEN.PA",
    "arkema": "AKE.PA", "ake": "AKE.PA",
    "bureau veritas": "BVI.PA", "bvi": "BVI.PA",
    "getlink": "GET.PA", "get": "GET.PA", "eurotunnel": "GET.PA",
    "jcdecaux": "DEC.PA", "dec": "DEC.PA",
    "rubis": "RUI.PA", "rui": "RUI.PA",
    "nexans": "NEX.PA", "nex": "NEX.PA",
    "valeo": "FR.PA", "fr": "FR.PA",
    "atos": "ATO.PA", "ato": "ATO.PA",
    "ipsen": "IPN.PA", "ipn": "IPN.PA",
    "imerys": "NK.PA", "nk": "NK.PA",
    "trigano": "TRI.PA", "tri": "TRI.PA",
    "interparfums": "ITP.PA", "itp": "ITP.PA",
    "coface": "COFA.PA", "cofa": "COFA.PA",
    "nexity": "NXI.PA", "nxi": "NXI.PA",
    "ose immuno": "OSE.PA", "ose": "OSE.PA",
    "eiffage": "FGR.PA", "fgr": "FGR.PA",
    "spie": "SPIE.PA", "spie": "SPIE.PA",
    "sopra steria": "SOP.PA", "sop": "SOP.PA",
    "sword group": "SWP.PA", "swp": "SWP.PA",
    "ubisoft": "UBI.PA", "ubi": "UBI.PA",
    "bolloré": "BOL.PA", "bollore": "BOL.PA", "bol": "BOL.PA",
    "elf beaute": "ELF.PA", "elf": "ELF.PA",
    "carrefour": "CA.PA", "ca": "CA.PA",
    "remy cointreau": "RCO.PA", "rco": "RCO.PA",
    "casino": "CO.PA", "co": "CO.PA",
    "technip": "FTI.PA", "technipfmc": "FTI.PA",
    "accor": "AC.PA", "ac": "AC.PA",
    "klepierre": "LI.PA", "li": "LI.PA",
    "unibail": "URW.PA", "unibail rodamco": "URW.PA", "urw": "URW.PA",
    "gecina": "GFC.PA", "gfc": "GFC.PA",
    "covivio": "COV.PA", "cov": "COV.PA",
    "scor": "SCR.PA", "scr": "SCR.PA",
    "eurazeo": "RF.PA", "rf": "RF.PA",
    "wendel": "MF.PA", "mf": "MF.PA",
    "amundi": "AMUN.PA", "amun": "AMUN.PA",
    "tikehau": "TKO.PA", "tko": "TKO.PA",
    "cac 40 etf": "CAC.PA",
    # ========== GERMANY (.DE) - DAX + MDAX ==========
    "siemens": "SIE.DE", "sie": "SIE.DE",
    "sap": "SAP.DE",
    "allianz": "ALV.DE", "alv": "ALV.DE",
    "bmw": "BMW.DE",
    "volkswagen": "VOW3.DE", "vw": "VOW3.DE",
    "mercedes": "MBG.DE", "mbg": "MBG.DE", "mercedes benz": "MBG.DE",
    "porsche": "P911.DE", "p911": "P911.DE",
    "adidas": "ADS.DE", "ads": "ADS.DE",
    "bayer": "BAYN.DE", "bayn": "BAYN.DE",
    "basf": "BAS.DE", "bas": "BAS.DE",
    "deutsche bank": "DBK.DE", "dbk": "DBK.DE",
    "deutsche post": "DHL.DE", "dhl": "DHL.DE",
    "deutsche telekom": "DTE.DE", "dte": "DTE.DE",
    "munich re": "MUV2.DE", "muv2": "MUV2.DE", "munchener ruck": "MUV2.DE",
    "infineon": "IFX.DE", "ifx": "IFX.DE",
    "henkel": "HEN3.DE", "hen3": "HEN3.DE",
    "continental": "CON.DE", "con": "CON.DE",
    "rheinmetall": "RHM.DE", "rhm": "RHM.DE",
    "commerzbank": "CBK.DE", "cbk": "CBK.DE",
    "zalando": "ZAL.DE", "zal": "ZAL.DE",
    "hellofresh": "HFG.DE", "hfg": "HFG.DE",
    "siemens energy": "ENR.DE", "enr": "ENR.DE",
    "siemens healthineers": "SHL.DE", "shl": "SHL.DE",
    "fresenius": "FRE.DE", "fre": "FRE.DE",
    "merck kgaa": "MRK.DE",
    "hannover ruck": "HNR1.DE", "hnr1": "HNR1.DE",
    "puma": "PUM.DE", "pum": "PUM.DE",
    "sartorius": "SRT3.DE", "srt3": "SRT3.DE",
    "symrise": "SY1.DE", "sy1": "SY1.DE",
    "vonovia": "VNA.DE", "vna": "VNA.DE",
    "brenntag": "BNR.DE", "bnr": "BNR.DE",
    "covestro": "1COV.DE",
    "eon": "EOAN.DE", "eoan": "EOAN.DE",
    "rwe": "RWE.DE", "rwe": "RWE.DE",
    "thyssenkrupp": "TKA.DE", "tka": "TKA.DE",
    "heidelberg materials": "HEI.DE", "hei": "HEI.DE",
    # ========== NETHERLANDS (.AS) - Euronext Amsterdam ==========
    "asml": "ASML.AS",
    "shell": "SHEL.AS", "shel": "SHEL.AS", "royal dutch shell": "SHEL.AS",
    "philips": "PHIA.AS", "phia": "PHIA.AS",
    "ing": "INGA.AS", "inga": "INGA.AS",
    "ahold": "AD.AS", "ahold delhaize": "AD.AS", "ad": "AD.AS",
    "heineken": "HEIA.AS", "heia": "HEIA.AS",
    "unilever": "UNA.AS", "una": "UNA.AS",
    "prosus": "PRX.AS", "prx": "PRX.AS",
    "wolters kluwer": "WKL.AS", "wkl": "WKL.AS",
    "adyen": "ADYEN.AS", "adyen": "ADYEN.AS",
    "nn group": "NN.AS", "nn": "NN.AS",
    "aegon": "AGN.AS", "agn": "AGN.AS",
    "akzo nobel": "AKZA.AS", "akza": "AKZA.AS",
    "dsm firmenich": "DSFIR.AS",
    "randstad": "RAND.AS", "rand": "RAND.AS",
    "just eat takeaway": "JTKWY", "just eat": "JTKWY",
    "arcelormittal": "MT.AS", "mt": "MT.AS",
    "exor": "EXO.AS", "exo": "EXO.AS",
    "be semiconductor": "BESI.AS", "besi": "BESI.AS",
    "asm international": "ASM.AS", "asm": "ASM.AS",
    # ========== ITALY (.MI) - FTSE MIB ==========
    "ferrari": "RACE.MI", "race": "RACE.MI",
    "enel": "ENEL.MI", "enel": "ENEL.MI",
    "eni": "ENI.MI",
    "intesa": "ISP.MI", "intesa sanpaolo": "ISP.MI", "isp": "ISP.MI",
    "unicredit": "UCG.MI", "ucg": "UCG.MI",
    "generali": "G.MI",
    "tenaris": "TEN.MI", "ten": "TEN.MI",
    "moncler": "MONC.MI", "monc": "MONC.MI",
    "campari": "CPR.MI", "cpr": "CPR.MI",
    "prysmian": "PRY.MI", "pry": "PRY.MI",
    "leonardo": "LDO.MI", "ldo": "LDO.MI",
    "mediobanca": "MB.MI", "mb": "MB.MI",
    "finecobank": "FBK.MI", "fbk": "FBK.MI",
    "nexi": "NEXI.MI", "nexi": "NEXI.MI",
    "saipem": "SPM.MI", "spm": "SPM.MI",
    "poste italiane": "PST.MI", "pst": "PST.MI",
    "banco bpm": "BAMI.MI", "bami": "BAMI.MI",
    "recordati": "REC.MI", "rec": "REC.MI",
    "brunello cucinelli": "BC.MI", "bc": "BC.MI",
    "pirelli": "PIRC.MI", "pirc": "PIRC.MI",
    "amplifon": "AMP.MI", "amp": "AMP.MI",
    "telecom italia": "TIT.MI", "tit": "TIT.MI",
    # ========== SPAIN (.MC) - IBEX 35 ==========
    "inditex": "ITX.MC", "itx": "ITX.MC", "zara": "ITX.MC",
    "santander": "SAN.MC", "banco santander": "SAN.MC",
    "bbva": "BBVA.MC",
    "iberdrola": "IBE.MC", "ibe": "IBE.MC",
    "telefonica": "TEF.MC", "tef": "TEF.MC",
    "repsol": "REP.MC", "rep": "REP.MC",
    "caixabank": "CABK.MC", "cabk": "CABK.MC",
    "amadeus": "AMS.MC", "ams": "AMS.MC",
    "ferrovial": "FER.MC", "fer": "FER.MC",
    "cellnex": "CLNX.MC", "clnx": "CLNX.MC",
    "endesa": "ELE.MC", "ele": "ELE.MC",
    "naturgy": "NTGY.MC", "ntgy": "NTGY.MC",
    "aena": "AENA.MC", "aena": "AENA.MC",
    "grifols": "GRF.MC", "grf": "GRF.MC",
    "fluidra": "FDR.MC", "fdr": "FDR.MC",
    # ========== BELGIUM (.BR) - Euronext Brussels ==========
    "ab inbev": "ABI.BR", "abi": "ABI.BR", "anheuser busch": "ABI.BR",
    "ucb": "UCB.BR",
    "kbc": "KBC.BR",
    "sofina": "SOF.BR", "sof": "SOF.BR",
    "umicore": "UMI.BR", "umi": "UMI.BR",
    "solvay": "SOLB.BR", "solb": "SOLB.BR",
    "ageas": "AGS.BR", "ags": "AGS.BR",
    "d'ieteren": "DIE.BR", "die": "DIE.BR",
    "melexis": "MELE.BR", "mele": "MELE.BR",
    # ========== FINLAND (.HE) - Helsinki ==========
    "nokia": "NOKIA.HE",
    "nordea": "NDA-FI.HE",
    "kone": "KNEBV.HE", "knebv": "KNEBV.HE",
    "neste": "NESTE.HE",
    "wartsila": "WRT1V.HE", "wrt1v": "WRT1V.HE",
    "stora enso": "STERV.HE", "sterv": "STERV.HE",
    "upm": "UPM.HE",
    "fortum": "FORTUM.HE",
    "sampo": "SAMPO.HE",
    "elisa": "ELISA.HE",
    # ========== PORTUGAL (.LS) - Euronext Lisbon ==========
    "edp": "EDP.LS",
    "galp": "GALP.LS",
    "jerónimo martins": "JMT.LS", "jeronimo martins": "JMT.LS", "jmt": "JMT.LS",
    # ========== IRELAND (.IR / .L) ==========
    "ryanair": "RYA.IR",
    "crh": "CRH.L",
    "kerry group": "KYG.IR", "kyg": "KYG.IR",
    "smurfit kappa": "SK3.IR", "sk3": "SK3.IR",
    # ========== DENMARK (.CO) ==========
    "novo nordisk": "NOVO-B.CO", "novo": "NOVO-B.CO",
    "carlsberg": "CARL-B.CO",
    "vestas": "VWS.CO", "vws": "VWS.CO",
    "orsted": "ORSTED.CO",
    "pandora": "PNDORA.CO", "pndora": "PNDORA.CO",
    "dsv": "DSV.CO",
    "coloplast": "COLO-B.CO",
    "genmab": "GMAB.CO", "gmab": "GMAB.CO",
    # ========== SWEDEN (.ST) ==========
    "ericsson": "ERIC-B.ST", "eric": "ERIC-B.ST",
    "volvo": "VOLV-B.ST",
    "atlas copco": "ATCO-A.ST",
    "sandvik": "SAND.ST", "sand": "SAND.ST",
    "abb": "ABB.ST",
    "hexagon": "HEXA-B.ST",
    "evolution": "EVO.ST", "evo": "EVO.ST",
    "spotify": "SPOT",
    "hm": "HM-B.ST", "h&m": "HM-B.ST",
    "investor ab": "INVE-B.ST",
    "alfa laval": "ALFA.ST", "alfa": "ALFA.ST",
    # ========== SWITZERLAND (.SW) - NOT PEA but major EU ==========
    "nestle": "NESN.SW", "nesn": "NESN.SW",
    "novartis": "NOVN.SW", "novn": "NOVN.SW",
    "roche": "ROG.SW", "rog": "ROG.SW",
    "ubs": "UBSG.SW", "ubsg": "UBSG.SW",
    "zurich": "ZURN.SW", "zurn": "ZURN.SW",
    "richemont": "CFR.SW", "cfr": "CFR.SW",
    "swatch": "UHR.SW", "uhr": "UHR.SW",
    "lonza": "LONN.SW", "lonn": "LONN.SW",
    "givaudan": "GIVN.SW", "givn": "GIVN.SW",
}


def resolve_ticker(query: str) -> Optional[str]:
    """Resolve a company name or partial query to a ticker symbol."""
    query = query.strip()
    if not query:
        return None

    # Check EU stock map first (case-insensitive)
    lower = query.lower()
    if lower in EU_STOCK_MAP:
        return EU_STOCK_MAP[lower]

    # If it already contains a dot (like SOI.PA), accept it directly
    if "." in query and len(query) <= 12:
        return query.upper()

    # If it looks like a US ticker (all alpha, short, no spaces), try directly
    if query.replace("-", "").isalpha() and len(query) <= 5:
        return query.upper()

    # Otherwise search Finnhub for the company name
    data = finnhub_get("search", {"q": query})
    if data and data.get("result"):
        # Prefer common stock on US exchanges
        for item in data["result"]:
            symbol = item.get("symbol", "")
            stype = item.get("type", "")
            if stype == "Common Stock" and "." not in symbol:
                return symbol
        # Then try any common stock (including EU)
        for item in data["result"]:
            symbol = item.get("symbol", "")
            stype = item.get("type", "")
            if stype == "Common Stock":
                return symbol
        # Fallback: return first result
        if data["result"]:
            return data["result"][0].get("symbol", "")

    # Last resort: try as yfinance ticker directly to validate
    try:
        t = yf.Ticker(query.upper())
        info = t.info
        if info.get("currentPrice") or info.get("regularMarketPrice"):
            return query.upper()
    except Exception:
        pass

    return query.upper().replace(" ", "")


# --- API Endpoints ---

@app.get("/search")
def search_ticker(q: str):
    """Search for tickers by company name or symbol."""
    query = q.strip().lower()
    results = []
    seen_symbols = set()

    # Check EU stock map first
    for name, ticker in EU_STOCK_MAP.items():
        if query in name or name.startswith(query):
            if ticker not in seen_symbols:
                seen_symbols.add(ticker)
                # Get display name from yfinance
                try:
                    t = yf.Ticker(ticker)
                    desc = t.info.get("shortName", name.title())
                except Exception:
                    desc = name.title()
                results.append({
                    "symbol": ticker,
                    "description": desc,
                    "type": "Common Stock (EU)",
                })
            if len(results) >= 3:
                break

    # Then search Finnhub for US/international
    data = finnhub_get("search", {"q": q.strip()})
    if not data or not data.get("result"):
        return {"results": results[:8]}

    for item in data["result"][:10]:
        symbol = item.get("symbol", "")
        # Allow .PA (Paris) and .DE (Germany) tickers, skip other foreign
        if "." in symbol:
            suffix = symbol.split(".")[-1]
            if suffix not in ("PA", "DE", "L", "AS", "MC", "MI", "BR", "HE", "LS", "IR", "CO", "ST", "SW"):
                continue
        if symbol in seen_symbols:
            continue
        seen_symbols.add(symbol)
        results.append({
            "symbol": symbol,
            "description": item.get("description", ""),
            "type": item.get("type", ""),
        })
    return {"results": results[:8]}


def _sanitize(obj):
    """Recursively replace NaN/Inf floats with None for JSON safety."""
    import math
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


@app.get("/analyze/{ticker}")
def analyze(ticker: str):
    ticker = resolve_ticker(ticker)

    profile = get_company_profile(ticker)
    if not profile or not profile.get("name"):
        raise HTTPException(status_code=404, detail="Ticker not found")

    price_data = get_realtime_price(ticker)
    fundamentals = get_fundamentals(ticker)
    technicals = get_technicals(ticker)
    historical = get_historical_data(ticker)
    news = get_news(ticker)
    sentiment = get_sentiment(ticker)

    return _sanitize({
        "ticker": ticker,
        "profile": profile,
        "price": price_data,
        "fundamentals": fundamentals,
        "technicals": technicals,
        "historical": historical,
        "news": news,
        "sentiment": sentiment,
    })


@app.get("/verdict/{ticker}")
def verdict(ticker: str):
    """
    Long-term investment composite signal.
    Weights: Business Quality 35%, Growth & Earnings 25%, Analyst Consensus 20%,
             Insider Activity 10%, Price & Entry 10%.
    Score: 0 (max bearish) to 100 (max bullish).
    """
    ticker = resolve_ticker(ticker)

    factors = []

    # =========================================================
    # 1. BUSINESS QUALITY (weight: 35) -- the most important factor
    #    Is this a fundamentally strong company?
    # =========================================================
    biz_score = 50
    biz_details = []

    fundamentals = get_fundamentals(ticker)
    if fundamentals["source"] != "unavailable":
        sub_scores = []

        # Operating margin -- can this company actually make money?
        op_margin = fundamentals.get("operating_margin")
        if op_margin is not None:
            if op_margin > 30:
                sub_scores.append(90)
                biz_details.append({
                    "name": "Profitability",
                    "value": f"{op_margin:.1f}% operating margin",
                    "signal": "Excellent",
                    "explanation": f"For every $100 this company earns in revenue, it keeps ${op_margin:.0f} as profit. That's a sign of a dominant business -- it can charge premium prices because customers have few alternatives. Companies like this tend to compound wealth over decades.",
                })
            elif op_margin > 15:
                sub_scores.append(65)
                biz_details.append({
                    "name": "Profitability",
                    "value": f"{op_margin:.1f}% operating margin",
                    "signal": "Solid",
                    "explanation": f"A {op_margin:.0f}% operating margin means the company is reliably profitable. It's not the most dominant business, but it earns good money and can weather downturns.",
                })
            elif op_margin > 0:
                sub_scores.append(35)
                biz_details.append({
                    "name": "Profitability",
                    "value": f"{op_margin:.1f}% operating margin",
                    "signal": "Thin",
                    "explanation": f"Only {op_margin:.0f}% margin means the company barely turns a profit. A recession, new competitor, or cost increase could easily push it into losses. Risky for long-term holding.",
                })
            else:
                sub_scores.append(10)
                biz_details.append({
                    "name": "Profitability",
                    "value": f"{op_margin:.1f}% operating margin",
                    "signal": "Losing Money",
                    "explanation": f"This company spends more than it earns. Some high-growth companies do this on purpose (investing in growth), but if it doesn't turn profitable eventually, long-term holders get wiped out.",
                })

        # Gross margin -- does it have pricing power?
        gross_margin = fundamentals.get("gross_margin")
        if gross_margin is not None:
            if gross_margin > 60:
                sub_scores.append(85)
                biz_details.append({
                    "name": "Pricing Power",
                    "value": f"{gross_margin:.1f}% gross margin",
                    "signal": "Strong Moat",
                    "explanation": f"A {gross_margin:.0f}% gross margin means the company's products/services cost very little to deliver relative to what customers pay. This usually indicates a strong competitive advantage (or 'moat') -- think software, luxury brands, or monopoly-like businesses. Hard to compete against.",
                })
            elif gross_margin > 40:
                sub_scores.append(60)
                biz_details.append({
                    "name": "Pricing Power",
                    "value": f"{gross_margin:.1f}% gross margin",
                    "signal": "Decent",
                    "explanation": f"A {gross_margin:.0f}% gross margin is respectable. The company has some pricing power but faces competition that limits how much it can charge.",
                })
            else:
                sub_scores.append(30)
                biz_details.append({
                    "name": "Pricing Power",
                    "value": f"{gross_margin:.1f}% gross margin",
                    "signal": "Commodity",
                    "explanation": f"A {gross_margin:.0f}% gross margin suggests the company sells products/services that are hard to differentiate. Customers can easily switch to competitors, so the company can't charge premium prices. Harder to build long-term wealth here.",
                })

        # Net debt -- can it survive a crisis?
        net_debt = fundamentals.get("net_debt")
        mcap = None
        try:
            t = yf.Ticker(ticker)
            mcap = t.info.get("marketCap")
        except Exception:
            pass

        if net_debt is not None:
            if net_debt < 0:
                sub_scores.append(80)
                cash = abs(net_debt)
                biz_details.append({
                    "name": "Financial Health",
                    "value": f"Net cash: ${cash / 1e9:.1f}B",
                    "signal": "Fortress",
                    "explanation": f"This company has ${cash / 1e9:.1f}B more cash than debt. It's a 'fortress balance sheet' -- it can survive recessions, invest in growth, buy competitors, or return money to shareholders. You don't have to worry about this company going bankrupt.",
                })
            elif mcap and net_debt / mcap < 0.3:
                sub_scores.append(55)
                biz_details.append({
                    "name": "Financial Health",
                    "value": f"Net debt: ${net_debt / 1e9:.1f}B",
                    "signal": "Manageable",
                    "explanation": f"The company has ${net_debt / 1e9:.1f}B in net debt, which is manageable relative to its size. Not a red flag, but something to watch if interest rates rise or profits dip.",
                })
            else:
                sub_scores.append(25)
                biz_details.append({
                    "name": "Financial Health",
                    "value": f"Net debt: ${net_debt / 1e9:.1f}B",
                    "signal": "Heavy Debt",
                    "explanation": f"${net_debt / 1e9:.1f}B in net debt is significant. High debt means high interest payments, which eat into profits. In a downturn, heavily indebted companies are the first to struggle. Risky for long-term.",
                })

        if sub_scores:
            biz_score = sum(sub_scores) / len(sub_scores)
    else:
        biz_details.append({
            "name": "Business Quality", "value": "Unavailable", "signal": "N/A",
            "explanation": "Fundamental data could not be loaded.",
        })

    factors.append({"category": "Business Quality", "score": biz_score, "weight": 35, "details": biz_details})

    # =========================================================
    # 2. GROWTH & EARNINGS TRAJECTORY (weight: 25)
    #    Is the company growing? Are earnings accelerating?
    # =========================================================
    growth_score = 50
    growth_details = []

    if fundamentals["source"] != "unavailable":
        sub_scores = []

        # Revenue growth
        rg = fundamentals.get("revenue_growth_yoy")
        if rg is not None:
            if rg > 25:
                sub_scores.append(90)
                growth_details.append({
                    "name": "Revenue Growth",
                    "value": f"+{rg:.1f}% year-over-year",
                    "signal": "Exceptional",
                    "explanation": f"Revenue grew {rg:.0f}% in the last year. For context, the average S&P 500 company grows 5-8%. A company growing this fast is capturing massive market demand. If this continues, the stock price will eventually follow -- even if it dips short-term.",
                })
            elif rg > 10:
                sub_scores.append(70)
                growth_details.append({
                    "name": "Revenue Growth",
                    "value": f"+{rg:.1f}% year-over-year",
                    "signal": "Strong",
                    "explanation": f"Revenue grew {rg:.0f}% -- well above average. The company is gaining market share and expanding. This is the kind of growth that creates long-term wealth.",
                })
            elif rg > 0:
                sub_scores.append(45)
                growth_details.append({
                    "name": "Revenue Growth",
                    "value": f"+{rg:.1f}% year-over-year",
                    "signal": "Slow",
                    "explanation": f"Revenue grew only {rg:.0f}%. The company isn't shrinking, but it's not conquering new markets either. Long-term returns will likely come from valuation changes or dividends, not explosive growth.",
                })
            else:
                sub_scores.append(15)
                growth_details.append({
                    "name": "Revenue Growth",
                    "value": f"{rg:.1f}% year-over-year",
                    "signal": "Declining",
                    "explanation": f"Revenue is shrinking ({rg:.0f}%). This is the most important red flag for long-term investors. A company making less money each year will almost certainly see its stock price fall over time, regardless of what analysts say.",
                })

        # Forward PE vs current PE -- are earnings expected to grow?
        pe = fundamentals.get("pe_ratio")
        fwd_pe = fundamentals.get("forward_pe")
        if pe is not None and fwd_pe is not None and pe > 0:
            growth_ratio = fwd_pe / pe
            if growth_ratio < 0.6:
                sub_scores.append(85)
                growth_details.append({
                    "name": "Earnings Trajectory",
                    "value": f"PE drops from {pe:.0f} to {fwd_pe:.0f} (forward)",
                    "signal": "Accelerating",
                    "explanation": f"Analysts expect earnings to grow so fast that the PE ratio drops from {pe:.0f} to {fwd_pe:.0f} within a year. The stock looks expensive today, but it's 'growing into' its price. Like buying a house in a neighborhood about to boom -- it seems pricey now but looks cheap in a year.",
                })
            elif growth_ratio < 0.85:
                sub_scores.append(65)
                growth_details.append({
                    "name": "Earnings Trajectory",
                    "value": f"PE drops from {pe:.0f} to {fwd_pe:.0f} (forward)",
                    "signal": "Growing",
                    "explanation": f"Forward PE ({fwd_pe:.0f}) is lower than current ({pe:.0f}), meaning earnings are expected to grow. This is a positive sign -- the company is becoming cheaper over time as it earns more.",
                })
            elif growth_ratio > 1.15:
                sub_scores.append(25)
                growth_details.append({
                    "name": "Earnings Trajectory",
                    "value": f"PE rises from {pe:.0f} to {fwd_pe:.0f} (forward)",
                    "signal": "Slowing",
                    "explanation": f"Forward PE ({fwd_pe:.0f}) is higher than current ({pe:.0f}), meaning analysts expect earnings to decline. The stock is getting more expensive over time, not less. This is a warning sign for long-term holders.",
                })
            else:
                sub_scores.append(50)
                growth_details.append({
                    "name": "Earnings Trajectory",
                    "value": f"PE: {pe:.0f} now, {fwd_pe:.0f} forward",
                    "signal": "Stable",
                    "explanation": f"Earnings are expected to stay roughly flat. The company isn't growing fast, but it's not shrinking either. Stable can be fine for dividend stocks, but limits upside for growth investors.",
                })

        # Earnings beat consistency (from Finnhub)
        earnings = finnhub_get("stock/earnings", {"symbol": ticker})
        if earnings and isinstance(earnings, list) and len(earnings) >= 3:
            beats = sum(1 for e in earnings if e.get("actual") and e.get("estimate") and e["actual"] > e["estimate"])
            total_q = len(earnings)
            beat_rate = beats / total_q
            if beat_rate >= 0.75:
                sub_scores.append(80)
                growth_details.append({
                    "name": "Earnings Track Record",
                    "value": f"Beat estimates {beats}/{total_q} quarters",
                    "signal": "Consistent",
                    "explanation": f"The company beat analyst expectations in {beats} out of {total_q} recent quarters. This means management consistently delivers better results than even Wall Street predicts. It's a sign of a well-run company that under-promises and over-delivers.",
                })
            elif beat_rate >= 0.5:
                sub_scores.append(55)
                growth_details.append({
                    "name": "Earnings Track Record",
                    "value": f"Beat estimates {beats}/{total_q} quarters",
                    "signal": "Mixed",
                    "explanation": f"The company beat expectations {beats} out of {total_q} quarters -- roughly half and half. The company sometimes delivers, sometimes disappoints. Not a strong signal either way.",
                })
            else:
                sub_scores.append(20)
                growth_details.append({
                    "name": "Earnings Track Record",
                    "value": f"Beat estimates only {beats}/{total_q} quarters",
                    "signal": "Disappointing",
                    "explanation": f"The company missed analyst estimates in most recent quarters. This is a red flag -- it suggests the business is weakening or management is overpromising. Long-term investors should be cautious.",
                })

        if sub_scores:
            growth_score = sum(sub_scores) / len(sub_scores)

    factors.append({"category": "Growth & Earnings", "score": growth_score, "weight": 25, "details": growth_details})

    # =========================================================
    # 3. ANALYST CONSENSUS (weight: 20)
    #    What do professional analysts who study this company full-time think?
    # =========================================================
    analyst_score = 50
    analyst_details = []

    sentiment = get_sentiment(ticker)
    if sentiment["source"] != "unavailable" and sentiment["analysts_total"] > 0:
        analyst_score = sentiment["score"] * 100

        total_a = sentiment["analysts_total"]
        sb = sentiment["strong_buy"]
        b = sentiment["buy"]
        h = sentiment["hold"]
        s = sentiment["sell"]
        ss = sentiment["strong_sell"]
        bullish_pct = round((sb + b) / total_a * 100)
        bearish_pct = round((s + ss) / total_a * 100)

        if analyst_score >= 70:
            analyst_details.append({
                "name": f"Analyst Recommendations ({total_a} analysts)",
                "value": f"{bullish_pct}% say Buy, {bearish_pct}% say Sell",
                "signal": "Bullish",
                "explanation": f"Out of {total_a} professional analysts who study this company full-time, {sb + b} recommend buying and only {s + ss} say sell. These analysts set 12-month price targets -- so this reflects their view of where the stock will be in a year, not tomorrow. Strong long-term consensus.",
            })
        elif analyst_score <= 40:
            analyst_details.append({
                "name": f"Analyst Recommendations ({total_a} analysts)",
                "value": f"{bearish_pct}% say Sell, {bullish_pct}% say Buy",
                "signal": "Bearish",
                "explanation": f"Most of the {total_a} analysts covering this stock don't think it's worth buying at current prices. When the majority of professionals who study a company full-time are negative, it's worth listening -- though they can be wrong.",
            })
        else:
            analyst_details.append({
                "name": f"Analyst Recommendations ({total_a} analysts)",
                "value": f"{bullish_pct}% Buy, {round(h / total_a * 100)}% Hold, {bearish_pct}% Sell",
                "signal": "Mixed",
                "explanation": f"Analysts are divided on this stock. When the experts disagree, it often means the stock's future depends on uncertain factors (economy, competition, new products). Higher risk, but also potential opportunity if things break the right way.",
            })
    else:
        analyst_details.append({
            "name": "Analyst Recommendations", "value": "No data", "signal": "N/A",
            "explanation": "Analyst recommendation data is not available.",
        })

    factors.append({"category": "Analyst Consensus", "score": analyst_score, "weight": 20, "details": analyst_details})

    # =========================================================
    # 4. INSIDER CONFIDENCE (weight: 10)
    #    Are the people running this company buying or selling stock?
    #    Low weight because insiders sell for many non-bearish reasons.
    # =========================================================
    insider_score = 50
    insider_details = []

    try:
        today = datetime.date.today()
        from_date = (today - datetime.timedelta(days=180)).strftime("%Y-%m-%d")
        to_date = today.strftime("%Y-%m-%d")
        insider_data = finnhub_get("stock/insider-transactions", {
            "symbol": ticker, "from": from_date, "to": to_date,
        })
        if insider_data and insider_data.get("data"):
            buy_val = 0
            sell_val = 0
            for item in insider_data["data"]:
                if item.get("isDerivative", False):
                    continue
                code = item.get("transactionCode", "")
                change = item.get("change", 0)
                price = item.get("transactionPrice", 0)
                val = abs(change * price) if price else 0
                if code == "P":
                    buy_val += val
                elif code == "S":
                    sell_val += val

            total_insider = buy_val + sell_val
            if total_insider > 0:
                buy_ratio = buy_val / total_insider

                if buy_ratio > 0.6:
                    insider_score = 85
                    insider_details.append({
                        "name": "Insider Activity (6 months)",
                        "value": f"${buy_val / 1e6:.1f}M bought vs ${sell_val / 1e6:.1f}M sold",
                        "signal": "Buying",
                        "explanation": f"Insiders are putting their own money into the stock. This is one of the strongest long-term signals because these people see the company's internal numbers, upcoming products, and future plans. When a CEO buys millions in stock, they're betting their personal wealth on the company's future.",
                    })
                elif buy_ratio > 0.2:
                    insider_score = 55
                    insider_details.append({
                        "name": "Insider Activity (6 months)",
                        "value": f"${buy_val / 1e6:.1f}M bought, ${sell_val / 1e6:.1f}M sold",
                        "signal": "Mixed",
                        "explanation": f"Some insider buying and some selling. This is normal -- insiders sell to diversify, pay taxes, or buy a house. Only matters if it's heavily one-sided. Not a strong signal either way for long-term investors.",
                    })
                else:
                    insider_score = 35
                    insider_details.append({
                        "name": "Insider Activity (6 months)",
                        "value": f"${sell_val / 1e6:.1f}M sold, ${buy_val / 1e6:.1f}M bought",
                        "signal": "Selling",
                        "explanation": f"Insiders are mostly selling. IMPORTANT CONTEXT: This alone is NOT a strong sell signal. Most large-cap CEOs sell regularly through pre-scheduled plans (called 10b5-1 plans) for tax purposes and diversification. Jensen Huang (NVIDIA CEO) has sold stock every quarter for years while the stock went up 10x. Insider selling only matters if the company's fundamentals are also deteriorating.",
                    })
            else:
                insider_score = 50
                insider_details.append({
                    "name": "Insider Activity (6 months)",
                    "value": "No significant activity",
                    "signal": "Neutral",
                    "explanation": "No major insider buying or selling in the last 6 months. This is neither good nor bad.",
                })
        else:
            insider_details.append({
                "name": "Insider Activity", "value": "No data", "signal": "N/A",
                "explanation": "Insider transaction data is not available.",
            })
    except Exception:
        insider_details.append({
            "name": "Insider Activity", "value": "Error", "signal": "N/A",
            "explanation": "Could not retrieve insider data.",
        })

    factors.append({"category": "Insider Confidence", "score": insider_score, "weight": 10, "details": insider_details})

    # =========================================================
    # 5. PRICE & ENTRY POINT (weight: 10)
    #    Is now a good time to buy, even if the company is great?
    #    Low weight because for true long-term investors, timing matters less.
    # =========================================================
    entry_score = 50
    entry_details = []

    technicals = get_technicals(ticker)
    if technicals["source"] != "unavailable":
        rsi = technicals.get("rsi")
        ma50_pos = technicals.get("price_vs_ma50")
        ma200_pos = technicals.get("price_vs_ma200")
        ma50_val = technicals.get("ma50")
        ma200_val = technicals.get("ma200")
        sub_scores = []

        # Continuous MA scoring: how far below/above averages (in %)
        # For long-term: below MAs = better entry = higher score
        try:
            price_data_entry = get_realtime_price(ticker)
            current_price = price_data_entry.get("price", 0)
        except Exception:
            current_price = 0

        if current_price and ma50_val and ma200_val:
            # % distance from MA50 and MA200 (negative = below = good for entry)
            dist_ma50 = ((current_price - ma50_val) / ma50_val) * 100
            dist_ma200 = ((current_price - ma200_val) / ma200_val) * 100
            avg_dist = (dist_ma50 + dist_ma200) / 2

            # Scale: -15% below avg = 90 (great discount), at avg = 50, +15% above = 15 (overheated)
            ma_score = max(10, min(95, 50 - (avg_dist * 2.67)))

            if ma50_pos == "below" and ma200_pos == "below":
                signal = "Potential Discount"
                explanation = f"The stock is {abs(dist_ma50):.1f}% below its 50-day average (${ma50_val}) and {abs(dist_ma200):.1f}% below its 200-day average (${ma200_val}). For a long-term investor, buying below both averages means you're getting a relative discount. The deeper the discount on a quality company, the better your long-term returns tend to be."
            elif ma50_pos == "above" and ma200_pos == "above":
                signal = "Full Price"
                explanation = f"The stock is {dist_ma50:.1f}% above its 50-day average (${ma50_val}) and {dist_ma200:.1f}% above its 200-day average (${ma200_val}). You're paying a premium over recent averages. Not a dealbreaker for long-term, but waiting for a dip could improve your entry."
            else:
                signal = "Fair"
                explanation = f"Price is between its moving averages (MA50: ${ma50_val}, MA200: ${ma200_val}). Not a deep discount but not overheated. A reasonable entry for long-term investors."

            sub_scores.append(ma_score)
            entry_details.append({
                "name": "Entry Timing",
                "value": f"{'Below' if avg_dist < 0 else 'Above'} averages by {abs(avg_dist):.1f}%",
                "signal": signal,
                "explanation": explanation,
            })
        elif ma50_pos and ma200_pos:
            # Fallback if we can't compute distance
            if ma50_pos == "below" and ma200_pos == "below":
                sub_scores.append(68)
            elif ma50_pos == "above" and ma200_pos == "above":
                sub_scores.append(38)
            else:
                sub_scores.append(52)
            entry_details.append({
                "name": "Entry Timing",
                "value": f"MA50: {ma50_pos}, MA200: {ma200_pos}",
                "signal": "See technicals",
                "explanation": "Price position relative to moving averages suggests a moderate entry point.",
            })

        # Continuous RSI scoring (for long-term: lower RSI = better entry)
        # RSI 15 → score 90, RSI 30 → score 75, RSI 50 → score 50, RSI 70 → score 25, RSI 85 → score 10
        if rsi is not None:
            rsi_score = max(10, min(90, 90 - (rsi - 15) * (80 / 70)))
            sub_scores.append(rsi_score)

            if rsi < 25:
                signal = "Extreme Fear"
                explanation = f"RSI of {rsi:.0f} means intense selling pressure -- panic in the market. For a long-term investor in a quality company, this is historically one of the BEST entry points. The market overreacts emotionally. Think of it as a deep-discount sale."
            elif rsi < 35:
                signal = "Fear"
                explanation = f"RSI of {rsi:.0f} shows meaningful selling pressure. The stock is being sold off, which for a long-term investor in a solid company, creates a better entry price. Not extreme panic, but sentiment is clearly negative."
            elif rsi < 55:
                signal = "Normal"
                explanation = f"RSI of {rsi:.0f} -- balanced buying and selling. No extreme emotion in either direction. A perfectly fine time to buy if you like the company long-term."
            elif rsi < 70:
                signal = "Optimism"
                explanation = f"RSI of {rsi:.0f} shows buying momentum. The stock is trending up, which means you're paying a bit more. Consider whether you want to wait for a slight pullback or just buy and hold."
            else:
                signal = "Hype"
                explanation = f"RSI of {rsi:.0f} means everyone is piling in. The stock is likely overbought short-term. Even great companies frequently pull back 10-20% from these levels. Patience could save you 5-15% on your entry price."

            entry_details.append({
                "name": "Short-Term Sentiment",
                "value": f"RSI: {rsi:.0f} ({signal.lower()})",
                "signal": signal,
                "explanation": explanation,
            })

        if sub_scores:
            entry_score = sum(sub_scores) / len(sub_scores)

    factors.append({"category": "Price & Entry Point", "score": entry_score, "weight": 10, "details": entry_details})

    # =========================================================
    # COMPOSITE SCORE (weighted)
    # =========================================================
    total_weight = sum(f["weight"] for f in factors)
    composite = sum(f["score"] * f["weight"] for f in factors) / total_weight if total_weight > 0 else 50

    # Overall verdict -- long-term framing
    if composite >= 75:
        verdict_label = "STRONG LONG-TERM BUY"
        verdict_explanation = "This looks like a high-quality company with strong growth, good profitability, and professional backing. Short-term price swings don't change the fundamentals. If you can hold for 3-5+ years, this has the characteristics of a long-term wealth compounder."
    elif composite >= 62:
        verdict_label = "LONG-TERM BUY"
        verdict_explanation = "The business fundamentals are solid and growth prospects are positive. There may be some short-term headwinds, but the long-term picture is favorable. A good candidate for a buy-and-hold portfolio."
    elif composite >= 48:
        verdict_label = "HOLD / WATCH"
        verdict_explanation = "This stock has both strengths and weaknesses. The business isn't bad, but it's not compelling enough for a confident long-term bet. Consider watching it -- if the fundamentals improve or the price drops significantly, it could become a buy."
    elif composite >= 35:
        verdict_label = "CAUTION"
        verdict_explanation = "More warning signs than positive signals. The business faces challenges that could hurt long-term returns. Consider whether you have a strong thesis for why this company will turn things around."
    else:
        verdict_label = "AVOID"
        verdict_explanation = "Weak fundamentals, deteriorating growth, or poor business quality. Even if the stock is cheap, there's usually a reason. Long-term investors should look elsewhere for better opportunities."

    # Data confidence: how many factors had real data vs defaults
    factors_with_data = sum(1 for f in factors if len(f.get("details", [])) > 0)
    total_factors = len(factors)
    data_confidence = round((factors_with_data / total_factors) * 100) if total_factors > 0 else 0

    # Tag each factor with whether it has real data
    for f in factors:
        f["has_data"] = len(f.get("details", [])) > 0

    # Add warning if low confidence
    data_warnings = []
    for f in factors:
        if not f["has_data"]:
            data_warnings.append(f"No data available for '{f['category']}' -- score defaulted to neutral (50)")

    return _sanitize({
        "ticker": ticker,
        "composite_score": round(composite, 1),
        "verdict": verdict_label,
        "verdict_explanation": verdict_explanation,
        "factors": factors,
        "data_confidence": data_confidence,
        "data_warnings": data_warnings,
    })


def get_news_yfinance(ticker: str) -> list:
    """Fallback: get news from yfinance (works for EU stocks)."""
    try:
        t = yf.Ticker(ticker)
        raw = t.news or []
        news = []
        for item in raw[:8]:
            content = item.get("content", {})
            title = content.get("title", "")
            if not title:
                continue
            provider = content.get("provider", {})
            pub_date = content.get("pubDate", "")
            url = ""
            click = content.get("clickThroughUrl", {})
            if click:
                url = click.get("url", "")
            canonical = content.get("canonicalUrl", {})
            if not url and canonical:
                url = canonical.get("url", "")
            # Parse timestamp
            ts = 0
            if pub_date:
                try:
                    dt = datetime.datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
                    ts = int(dt.timestamp())
                except Exception:
                    pass
            summary = content.get("summary", "")
            news.append({
                "headline": title,
                "source": provider.get("displayName", "Yahoo Finance"),
                "url": url,
                "datetime": ts,
                "summary": summary[:300] if summary else "",
            })
        return news
    except Exception:
        return []


def get_news_google_rss(query: str) -> list:
    """Scrape Google News RSS for a company/ticker."""
    try:
        import xml.etree.ElementTree as ET
        import html
        import re
        url = f"https://news.google.com/rss/search?q={requests.utils.quote(query + ' stock')}&hl=en&gl=US&ceid=US:en"
        resp = requests.get(url, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            return []

        root = ET.fromstring(resp.content)
        news = []
        for item in root.findall(".//item")[:10]:
            title_el = item.find("title")
            link_el = item.find("link")
            pub_el = item.find("pubDate")
            source_el = item.find("source")

            title = html.unescape(title_el.text) if title_el is not None and title_el.text else ""
            link = link_el.text if link_el is not None and link_el.text else ""
            source = source_el.text if source_el is not None and source_el.text else "Google News"

            # Parse pubDate (format: "Wed, 26 Mar 2026 14:30:00 GMT")
            ts = 0
            if pub_el is not None and pub_el.text:
                try:
                    from email.utils import parsedate_to_datetime
                    dt = parsedate_to_datetime(pub_el.text)
                    ts = int(dt.timestamp())
                except Exception:
                    pass

            if title:
                news.append({
                    "headline": title,
                    "source": source,
                    "url": link,
                    "datetime": ts,
                    "summary": "",
                })
        return news
    except Exception:
        return []


@app.get("/news/{ticker}")
def news_endpoint(ticker: str):
    ticker = resolve_ticker(ticker)

    all_news = []
    seen_headlines = set()

    def _add_unique(articles):
        for a in articles:
            # Deduplicate by headline similarity (first 50 chars lowercase)
            key = a["headline"][:50].lower().strip()
            if key not in seen_headlines:
                seen_headlines.add(key)
                all_news.append(a)

    # Source 1: Finnhub (US stocks, high quality)
    _add_unique(get_news(ticker))

    # Source 2: yfinance/Yahoo Finance (works for EU too, has summaries)
    _add_unique(get_news_yfinance(ticker))

    # Source 3: Google News RSS (broadest coverage, any stock)
    # Use company name if available for better results
    try:
        t = yf.Ticker(ticker)
        company_name = (t.info or {}).get("shortName", ticker)
    except Exception:
        company_name = ticker
    _add_unique(get_news_google_rss(company_name))

    # Sort by timestamp (newest first)
    all_news.sort(key=lambda x: x.get("datetime", 0), reverse=True)

    # Limit to 15 articles
    all_news = all_news[:15]

    sentiment = get_sentiment(ticker)

    return _sanitize({
        "ticker": ticker,
        "news": all_news,
        "sentiment": sentiment,
    })


@app.get("/short-term/{ticker}")
def short_term_verdict(ticker: str):
    """
    Short-term trading signal (1-4 weeks horizon).
    Weights: Momentum 25%, Technicals 25%, Volume 15%, News Catalyst 15%, Analyst Short-term 20%.
    """
    ticker = resolve_ticker(ticker)

    factors = []

    # =========================================================
    # 1. PRICE MOMENTUM (weight: 25)
    # =========================================================
    momentum_score = 50
    momentum_details = []

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="3mo")
        if not hist.empty and len(hist) >= 20:
            closes = hist["Close"].values
            current = float(closes[-1])

            # 5-day return
            if len(closes) >= 6:
                ret_5d = ((current - float(closes[-6])) / float(closes[-6])) * 100
                if ret_5d > 5:
                    s = min(90, 70 + ret_5d)
                    momentum_details.append({"name": "5-Day Move", "value": f"{ret_5d:+.1f}%",
                        "signal": "Strong Rally", "explanation": f"The stock gained {ret_5d:.1f}% in 5 days — strong upward momentum. This often continues short-term but watch for exhaustion."})
                elif ret_5d > 1:
                    s = 60 + ret_5d * 2
                    momentum_details.append({"name": "5-Day Move", "value": f"{ret_5d:+.1f}%",
                        "signal": "Positive", "explanation": f"Modest gains of {ret_5d:.1f}% over 5 days — the trend is gently upward."})
                elif ret_5d > -1:
                    s = 50
                    momentum_details.append({"name": "5-Day Move", "value": f"{ret_5d:+.1f}%",
                        "signal": "Flat", "explanation": f"Essentially flat over 5 days ({ret_5d:+.1f}%). No strong direction — wait for a catalyst."})
                elif ret_5d > -5:
                    s = 40 + ret_5d * 2
                    momentum_details.append({"name": "5-Day Move", "value": f"{ret_5d:+.1f}%",
                        "signal": "Weak", "explanation": f"Down {abs(ret_5d):.1f}% in 5 days — some selling pressure. Could bounce or continue lower."})
                else:
                    s = max(10, 30 + ret_5d)
                    momentum_details.append({"name": "5-Day Move", "value": f"{ret_5d:+.1f}%",
                        "signal": "Selloff", "explanation": f"Dropped {abs(ret_5d):.1f}% in just 5 days — significant selling. Check news for the catalyst."})
                momentum_score = s

            # 20-day return
            if len(closes) >= 21:
                ret_20d = ((current - float(closes[-21])) / float(closes[-21])) * 100
                if ret_20d > 10:
                    m20_s = 80
                    signal = "Strong Uptrend"
                elif ret_20d > 3:
                    m20_s = 65
                    signal = "Uptrend"
                elif ret_20d > -3:
                    m20_s = 50
                    signal = "Sideways"
                elif ret_20d > -10:
                    m20_s = 35
                    signal = "Downtrend"
                else:
                    m20_s = 20
                    signal = "Strong Downtrend"
                momentum_details.append({"name": "20-Day Trend", "value": f"{ret_20d:+.1f}%",
                    "signal": signal, "explanation": f"Over the past month, the stock moved {ret_20d:+.1f}%. This gives context to whether the 5-day move is part of a larger trend or a reversal."})
                momentum_score = (momentum_score + m20_s) / 2
    except Exception:
        pass

    factors.append({"category": "Price Momentum", "score": round(momentum_score, 0), "weight": 25, "details": momentum_details})

    # =========================================================
    # 2. TECHNICALS / RSI + MA (weight: 25)
    # =========================================================
    tech_score = 50
    tech_details = []

    technicals = get_technicals(ticker)
    if technicals["source"] != "unavailable":
        rsi = technicals.get("rsi")
        ma50_pos = technicals.get("price_vs_ma50")
        ma200_pos = technicals.get("price_vs_ma200")

        # RSI for short-term: oversold = buy signal, overbought = sell signal
        if rsi is not None:
            if rsi < 25:
                rsi_s = 85
                signal = "Extremely Oversold"
                expl = f"RSI at {rsi:.0f} — extreme oversold territory. Historically, stocks bounce hard from these levels within 1-2 weeks. High probability of a short-term rally."
            elif rsi < 35:
                rsi_s = 70
                signal = "Oversold"
                expl = f"RSI at {rsi:.0f} — oversold. Selling pressure is fading and a bounce is likely within days to a week."
            elif rsi < 55:
                rsi_s = 50
                signal = "Neutral"
                expl = f"RSI at {rsi:.0f} — balanced. No extreme in either direction. The stock could go either way short-term."
            elif rsi < 70:
                rsi_s = 35
                signal = "Overbought Warning"
                expl = f"RSI at {rsi:.0f} — getting warm. Momentum is strong but a pullback could come anytime. Careful with new entries."
            else:
                rsi_s = 15
                signal = "Overbought"
                expl = f"RSI at {rsi:.0f} — overbought. The stock has run too far too fast. High risk of a short-term pullback of 5-15%."
            tech_details.append({"name": "RSI Signal", "value": f"{rsi:.0f}", "signal": signal, "explanation": expl})
            tech_score = rsi_s

        # MA cross signals
        if ma50_pos == "above" and ma200_pos == "above":
            ma_s = 65
            tech_details.append({"name": "Moving Averages", "value": "Above both MA50 & MA200",
                "signal": "Bullish Structure", "explanation": "Price is above both key averages — the trend is up. Short-term traders want to buy dips in this structure, not fight the trend."})
        elif ma50_pos == "below" and ma200_pos == "below":
            ma_s = 30
            tech_details.append({"name": "Moving Averages", "value": "Below both MA50 & MA200",
                "signal": "Bearish Structure", "explanation": "Price is below both key averages — the trend is down. Short-term rallies tend to fail. Only trade bounces with tight stops."})
        elif ma50_pos == "above":
            ma_s = 55
            tech_details.append({"name": "Moving Averages", "value": "Above MA50, below MA200",
                "signal": "Recovery", "explanation": "Price reclaimed the short-term average but not the long-term one. Could be the start of a reversal or just a dead cat bounce."})
        else:
            ma_s = 40
            tech_details.append({"name": "Moving Averages", "value": "Below MA50, above MA200",
                "signal": "Weakening", "explanation": "Lost the short-term average but still above long-term support. A critical level — if MA200 breaks, expect acceleration down."})
        tech_score = (tech_score + ma_s) / 2

    factors.append({"category": "Technical Setup", "score": round(tech_score, 0), "weight": 25, "details": tech_details})

    # =========================================================
    # 3. VOLUME SIGNAL (weight: 15)
    # =========================================================
    vol_score = 50
    vol_details = []

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="3mo")
        if not hist.empty and len(hist) >= 20:
            volumes = hist["Volume"].values
            closes = hist["Close"].values
            avg_vol_20 = float(np.mean(volumes[-20:]))
            recent_vol = float(np.mean(volumes[-3:]))
            last_close_change = (float(closes[-1]) - float(closes[-2])) / float(closes[-2]) * 100

            if avg_vol_20 > 0:
                vol_ratio = recent_vol / avg_vol_20

                if vol_ratio > 2.0 and last_close_change > 0:
                    vol_score = 80
                    vol_details.append({"name": "Volume Surge", "value": f"{vol_ratio:.1f}x avg volume",
                        "signal": "Buying Frenzy", "explanation": f"Volume is {vol_ratio:.1f}x above normal AND the price is up. Big buyers are stepping in — institutions or news-driven demand. This often signals the start of a move."})
                elif vol_ratio > 2.0 and last_close_change < 0:
                    vol_score = 20
                    vol_details.append({"name": "Volume Surge", "value": f"{vol_ratio:.1f}x avg volume",
                        "signal": "Panic Selling", "explanation": f"Volume is {vol_ratio:.1f}x above normal but the price is DOWN. Heavy selling — someone big is exiting. Often precedes more downside short-term."})
                elif vol_ratio > 1.3:
                    vol_score = 55 + (10 if last_close_change > 0 else -10)
                    vol_details.append({"name": "Volume", "value": f"{vol_ratio:.1f}x avg volume",
                        "signal": "Above Average", "explanation": f"Slightly elevated volume ({vol_ratio:.1f}x normal). More interest than usual but not a decisive signal on its own."})
                elif vol_ratio < 0.6:
                    vol_score = 45
                    vol_details.append({"name": "Volume", "value": f"{vol_ratio:.1f}x avg (low)",
                        "signal": "Low Interest", "explanation": f"Volume is {vol_ratio:.1f}x below average. No one's paying attention. Low-volume moves are unreliable — they can reverse quickly."})
                else:
                    vol_score = 50
                    vol_details.append({"name": "Volume", "value": f"{vol_ratio:.1f}x avg",
                        "signal": "Normal", "explanation": "Volume is in the normal range. No unusual buying or selling activity detected."})
    except Exception:
        pass

    factors.append({"category": "Volume Signal", "score": round(vol_score, 0), "weight": 15, "details": vol_details})

    # =========================================================
    # 4. NEWS CATALYST (weight: 15)
    # =========================================================
    news_score = 50
    news_details = []

    news_items = get_news(ticker)
    if not news_items:
        news_items = get_news_yfinance(ticker)

    if news_items and len(news_items) >= 3:
        news_score = 55
        news_details.append({"name": "News Activity", "value": f"{len(news_items)} recent articles",
            "signal": "Active Coverage", "explanation": f"Found {len(news_items)} recent news articles. Active news coverage means the stock is on traders' radar, which increases short-term volatility and potential catalysts."})
    elif news_items and len(news_items) >= 1:
        news_score = 50
        news_details.append({"name": "News Activity", "value": f"{len(news_items)} recent articles",
            "signal": "Some Coverage", "explanation": f"A few recent news items. Nothing overwhelming but the stock isn't completely forgotten."})
    else:
        news_score = 45
        news_details.append({"name": "News Activity", "value": "No recent news",
            "signal": "Quiet", "explanation": "No recent news coverage found. Without a catalyst, the stock is likely to drift sideways or follow the broader market."})

    factors.append({"category": "News Catalyst", "score": round(news_score, 0), "weight": 15, "details": news_details})

    # =========================================================
    # 5. ANALYST SHORT-TERM (weight: 20)
    # =========================================================
    analyst_score = 50
    analyst_details = []

    sentiment = get_sentiment(ticker)
    if sentiment["source"] != "unavailable" and sentiment["analysts_total"] > 0:
        score_raw = sentiment["score"]
        analyst_score = score_raw * 100  # 0-1 → 0-100
        total = sentiment["analysts_total"]
        sb = sentiment["strong_buy"]
        b = sentiment["buy"]
        h = sentiment["hold"]
        s = sentiment["sell"]
        ss = sentiment["strong_sell"]

        buy_pct = round(((sb + b) / total) * 100)
        sell_pct = round(((s + ss) / total) * 100)

        if buy_pct >= 70:
            signal = "Strong Consensus Buy"
            expl = f"{buy_pct}% of {total} analysts say Buy/Strong Buy. Overwhelming professional consensus supports upside. However, be aware that when everyone agrees, contrarian risk exists."
        elif buy_pct >= 50:
            signal = "Majority Buy"
            expl = f"{buy_pct}% of {total} analysts are bullish. Most pros see upside, but there's meaningful disagreement ({sell_pct}% say Sell). The bull case isn't unanimous."
        elif sell_pct >= 50:
            signal = "Majority Sell"
            expl = f"{sell_pct}% of {total} analysts say Sell. More than half the pros think this stock is going down. Take that seriously for short-term positioning."
        else:
            signal = "Mixed/Split"
            expl = f"Analysts are divided — {buy_pct}% Buy vs {sell_pct}% Sell. No clear consensus. The stock could go either way based on the next catalyst."

        analyst_details.append({"name": "Analyst Consensus", "value": f"{buy_pct}% Buy, {sell_pct}% Sell ({total} analysts)",
            "signal": signal, "explanation": expl})
    else:
        analyst_details.append({"name": "Analyst Coverage", "value": "No data",
            "signal": "N/A", "explanation": "No analyst recommendation data available for this stock."})

    factors.append({"category": "Analyst Consensus", "score": round(analyst_score, 0), "weight": 20, "details": analyst_details})

    # =========================================================
    # COMPOSITE
    # =========================================================
    total_weight = sum(f["weight"] for f in factors)
    composite = sum(f["score"] * f["weight"] for f in factors) / total_weight if total_weight > 0 else 50

    # Verdict labels (short-term oriented)
    if composite >= 72:
        verdict_label = "SHORT-TERM BUY"
        verdict_explanation = "Strong short-term setup. Momentum, technicals, and volume all point upward. If you're looking for a trade, the stars are aligned for the next 1-4 weeks."
    elif composite >= 60:
        verdict_label = "LEAN BULLISH"
        verdict_explanation = "More positive signals than negative. Not a screaming buy, but the short-term bias is to the upside. A small pullback could be a good entry."
    elif composite >= 45:
        verdict_label = "NEUTRAL / WAIT"
        verdict_explanation = "Mixed signals. No clear short-term direction. Better to wait for a catalyst, a breakout, or a clearer setup before committing capital."
    elif composite >= 32:
        verdict_label = "LEAN BEARISH"
        verdict_explanation = "More warning signs than positive signals. Momentum is fading or already negative. If you're holding, tighten your stops. Not a great time to add."
    else:
        verdict_label = "SHORT-TERM SELL"
        verdict_explanation = "Technical breakdown, heavy selling, and/or negative catalysts. Short-term pain is likely. If you're holding, consider reducing. If you're watching, wait for a bottom."

    # Data confidence
    factors_with_data = sum(1 for f in factors if len(f.get("details", [])) > 0)
    total_factors = len(factors)
    data_confidence = round((factors_with_data / total_factors) * 100) if total_factors > 0 else 0
    for f in factors:
        f["has_data"] = len(f.get("details", [])) > 0
    data_warnings = [f"No data for '{f['category']}' -- defaulted to neutral" for f in factors if not f["has_data"]]

    return _sanitize({
        "ticker": ticker,
        "composite_score": round(composite, 1),
        "verdict": verdict_label,
        "verdict_explanation": verdict_explanation,
        "factors": factors,
        "data_confidence": data_confidence,
        "data_warnings": data_warnings,
    })


@app.get("/portfolio")
def get_portfolio():
    return {"positions": list(portfolio.values())}


@app.post("/portfolio")
def add_position(pos: PortfolioPosition):
    ticker = pos.ticker.upper().strip()
    portfolio[ticker] = {
        "ticker": ticker,
        "shares": pos.shares,
        "avg_price": pos.avg_price,
    }
    return {"status": "ok", "position": portfolio[ticker]}


@app.delete("/portfolio/{ticker}")
def remove_position(ticker: str):
    ticker = ticker.upper().strip()
    if ticker in portfolio:
        del portfolio[ticker]
        return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Position not found")


@app.get("/portfolio/pnl")
def portfolio_pnl():
    results = []
    total_value = 0
    total_cost = 0

    for ticker, pos in portfolio.items():
        price_data = get_realtime_price(ticker)
        current_price = price_data.get("price", 0)
        cost = pos["shares"] * pos["avg_price"]
        value = pos["shares"] * current_price
        pnl = value - cost
        pnl_pct = ((current_price - pos["avg_price"]) / pos["avg_price"] * 100) if pos["avg_price"] > 0 else 0

        total_value += value
        total_cost += cost

        results.append({
            "ticker": ticker,
            "shares": pos["shares"],
            "avg_price": pos["avg_price"],
            "current_price": current_price,
            "value": round(value, 2),
            "cost": round(cost, 2),
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 1),
            "allocation_pct": 0,  # filled below
        })

    # Compute allocation percentages
    if total_value > 0:
        for r in results:
            r["allocation_pct"] = round(r["value"] / total_value * 100, 1)

    return {
        "positions": results,
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_pnl": round(total_value - total_cost, 2),
        "total_pnl_pct": round(((total_value - total_cost) / total_cost * 100) if total_cost > 0 else 0, 1),
    }


@app.get("/insiders/{ticker}")
def insider_transactions(ticker: str):
    """Get insider transactions from Finnhub (last 6 months)."""
    ticker = resolve_ticker(ticker)

    # Fetch last 6 months of insider transactions
    today = datetime.date.today()
    from_date = (today - datetime.timedelta(days=180)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    data = finnhub_get("stock/insider-transactions", {
        "symbol": ticker,
        "from": from_date,
        "to": to_date,
    })
    if not data or not data.get("data"):
        return {"ticker": ticker, "transactions": [], "summary": {}}

    transactions = []
    seen = set()
    for item in data["data"]:
        # Only non-derivative transactions (actual stock buys/sells)
        if item.get("isDerivative", False):
            continue

        change = item.get("change", 0)
        price = item.get("transactionPrice", 0)
        name = item.get("name", "Unknown")
        date = item.get("transactionDate", "")
        code = item.get("transactionCode", "")

        # Deduplicate by name+date+change
        key = f"{name}:{date}:{change}"
        if key in seen:
            continue
        seen.add(key)

        # Only BUY and SELL (skip exercises, tax withholding, etc.)
        if code == "P":
            tx_type = "BUY"
        elif code == "S":
            tx_type = "SELL"
        else:
            continue

        value = abs(change * price) if price else 0

        transactions.append({
            "name": name,
            "type": tx_type,
            "shares": change,
            "price": round(price, 2) if price else None,
            "value": round(value, 2),
            "date": date,
            "filing_date": item.get("filingDate", ""),
        })

    # Sort by date descending
    transactions.sort(key=lambda x: x["date"], reverse=True)

    # Compute summary by insider
    insider_summary = {}
    for tx in transactions:
        name = tx["name"]
        if name not in insider_summary:
            insider_summary[name] = {"name": name, "buy_value": 0, "sell_value": 0, "buy_shares": 0, "sell_shares": 0, "tx_count": 0}
        insider_summary[name]["tx_count"] += 1
        if tx["type"] == "BUY":
            insider_summary[name]["buy_value"] += tx["value"]
            insider_summary[name]["buy_shares"] += abs(tx["shares"])
        else:
            insider_summary[name]["sell_value"] += tx["value"]
            insider_summary[name]["sell_shares"] += abs(tx["shares"])

    # Sort summary by total value (sells + buys)
    summary_list = sorted(insider_summary.values(), key=lambda x: x["sell_value"] + x["buy_value"], reverse=True)

    total_buy_value = sum(s["buy_value"] for s in summary_list)
    total_sell_value = sum(s["sell_value"] for s in summary_list)

    return {
        "ticker": ticker,
        "transactions": transactions,
        "summary": {
            "by_insider": summary_list[:10],
            "total_buy_value": round(total_buy_value, 2),
            "total_sell_value": round(total_sell_value, 2),
            "total_transactions": len(transactions),
            "period_from": from_date,
            "period_to": to_date,
        },
    }


@app.get("/earnings/{ticker}")
def earnings_data(ticker: str):
    """Get earnings history and next earnings date from Finnhub + yfinance."""
    ticker = resolve_ticker(ticker)

    # --- Earnings history: merge Finnhub + yfinance for max coverage ---
    earnings_history = []
    seen_periods = set()

    # 1) Finnhub earnings (usually 4 quarters)
    history = finnhub_get("stock/earnings", {"symbol": ticker})
    if history and isinstance(history, list):
        for item in history:
            period = item.get("period", "")
            if period in seen_periods:
                continue
            seen_periods.add(period)
            earnings_history.append({
                "period": period,
                "quarter": item.get("quarter"),
                "year": item.get("year"),
                "actual": item.get("actual"),
                "estimate": item.get("estimate"),
                "surprise": item.get("surprise"),
                "surprise_pct": item.get("surprisePercent"),
                "source": "finnhub",
            })

    # 2) yfinance earnings_history (may have different/additional quarters)
    # Deduplicate by matching actual EPS values (since dates differ between sources)
    existing_actuals = set()
    for e in earnings_history:
        if e["actual"] is not None:
            existing_actuals.add(round(e["actual"], 2))

    try:
        t = yf.Ticker(ticker)
        eh = t.earnings_history
        if eh is not None and not eh.empty:
            for idx, row in eh.iterrows():
                actual = float(row.get("epsActual")) if row.get("epsActual") is not None else None
                # Skip if we already have this earnings report (same actual EPS)
                if actual is not None and round(actual, 2) in existing_actuals:
                    continue

                report_date = str(idx.date()) if hasattr(idx, 'date') else str(idx)
                estimate = float(row.get("epsEstimate")) if row.get("epsEstimate") is not None else None
                surprise_pct = float(row.get("surprisePercent")) * 100 if row.get("surprisePercent") is not None else None
                surprise = float(row.get("epsDifference")) if row.get("epsDifference") is not None else None

                month = idx.month if hasattr(idx, 'month') else None
                quarter = ((month - 1) // 3 + 1) if month else None

                if actual is not None:
                    existing_actuals.add(round(actual, 2))

                earnings_history.append({
                    "period": report_date,
                    "quarter": quarter,
                    "year": idx.year if hasattr(idx, 'year') else None,
                    "actual": actual,
                    "estimate": estimate,
                    "surprise": surprise,
                    "surprise_pct": surprise_pct,
                    "source": "yfinance",
                })
    except Exception:
        pass

    # Sort by period descending, keep up to 8 most recent
    earnings_history.sort(key=lambda x: x["period"], reverse=True)
    earnings_history = earnings_history[:8]

    # Earnings calendar (next earnings)
    calendar = finnhub_get("calendar/earnings", {"symbol": ticker})
    next_earnings = None
    if calendar and calendar.get("earningsCalendar"):
        for entry in calendar["earningsCalendar"]:
            ed = entry.get("date", "")
            if ed:
                try:
                    edate = datetime.datetime.strptime(ed, "%Y-%m-%d").date()
                    today = datetime.date.today()
                    if edate >= today:
                        days_until = (edate - today).days
                        next_earnings = {
                            "date": ed,
                            "days_until": days_until,
                            "hour": entry.get("hour", ""),
                            "eps_estimate": entry.get("epsEstimate"),
                            "revenue_estimate": entry.get("revenueEstimate"),
                        }
                except ValueError:
                    pass

    # If no future earnings found, check yfinance
    if not next_earnings:
        try:
            t = yf.Ticker(ticker)
            cal = t.calendar
            if cal is not None and hasattr(cal, 'get'):
                ed = cal.get("Earnings Date")
                if ed and len(ed) > 0:
                    edate = ed[0].date() if hasattr(ed[0], 'date') else ed[0]
                    today = datetime.date.today()
                    days_until = (edate - today).days
                    if days_until >= 0:
                        next_earnings = {
                            "date": str(edate),
                            "days_until": days_until,
                            "hour": "",
                            "eps_estimate": None,
                            "revenue_estimate": None,
                        }
        except Exception:
            pass

    return {
        "ticker": ticker,
        "history": earnings_history,
        "next_earnings": next_earnings,
    }


@app.get("/peers/{ticker}")
def peer_comparison(ticker: str):
    """Get peer comparison data."""
    ticker = resolve_ticker(ticker)

    # Get peers from Finnhub
    peers_data = finnhub_get("stock/peers", {"symbol": ticker})
    if not peers_data or not isinstance(peers_data, list):
        return {"ticker": ticker, "peers": []}

    # Remove self and duplicates, limit to 5 peers
    peers_list = []
    seen = {ticker}
    for p in peers_data:
        if p not in seen and "." not in p:
            seen.add(p)
            peers_list.append(p)
        if len(peers_list) >= 5:
            break

    # Fetch key metrics for each peer (and self)
    all_tickers = [ticker] + peers_list
    results = []

    for t in all_tickers:
        try:
            yft = yf.Ticker(t)
            info = yft.info or {}

            price = info.get("currentPrice") or info.get("regularMarketPrice")
            change_pct = None
            prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
            if price and prev_close and prev_close > 0:
                change_pct = round((price - prev_close) / prev_close * 100, 1)

            mcap = info.get("marketCap")
            pe = _safe_float(info.get("trailingPE"))
            fwd_pe = _safe_float(info.get("forwardPE"))
            rev_growth = _pct(info.get("revenueGrowth"))
            gross_margin = _pct(info.get("grossMargins"))
            op_margin = _pct(info.get("operatingMargins"))

            # Quick RSI
            hist = yft.history(period="3mo")
            rsi_val = None
            if not hist.empty and len(hist) >= 15:
                rsi_val = round(compute_rsi(hist["Close"].values, 14) or 0, 1)

            results.append({
                "ticker": t,
                "name": info.get("shortName", t),
                "price": round(float(price), 2) if price else None,
                "change_pct": change_pct,
                "market_cap": mcap,
                "pe_ratio": pe,
                "forward_pe": fwd_pe,
                "revenue_growth": rev_growth,
                "gross_margin": gross_margin,
                "operating_margin": op_margin,
                "rsi": rsi_val,
                "is_target": t == ticker,
            })
        except Exception:
            results.append({
                "ticker": t,
                "name": t,
                "price": None,
                "change_pct": None,
                "market_cap": None,
                "pe_ratio": None,
                "forward_pe": None,
                "revenue_growth": None,
                "gross_margin": None,
                "operating_margin": None,
                "rsi": None,
                "is_target": t == ticker,
            })

    return {"ticker": ticker, "peers": results}


# =========================================================
# RANKINGS — Pre-computed top stocks
# =========================================================

RANKINGS_UNIVERSE = [
    # ===== US TECH (30) =====
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "NFLX", "AMD", "CRM",
    "AVGO", "ORCL", "ADBE", "INTC", "QCOM", "MU", "PLTR", "SNOW", "SHOP", "SQ",
    "UBER", "COIN", "RBLX", "PANW", "CRWD", "DDOG", "ZS", "NET", "MRVL", "ON",
    # ===== US FINANCE (15) =====
    "JPM", "V", "MA", "BAC", "GS", "MS", "BLK", "SCHW", "AXP", "C",
    "WFC", "USB", "PNC", "BX", "KKR",
    # ===== US HEALTH (15) =====
    "UNH", "JNJ", "PFE", "LLY", "ABBV", "MRK", "TMO", "ABT", "AMGN", "BMY",
    "GILD", "ISRG", "VRTX", "REGN", "MDT",
    # ===== US INDUSTRIAL / ENERGY (20) =====
    "XOM", "CVX", "BA", "CAT", "GE", "RTX", "LMT", "HON", "UPS", "DE",
    "MMM", "GD", "NOC", "FDX", "EMR", "SLB", "COP", "PSX", "OXY", "VLO",
    # ===== US CONSUMER (15) =====
    "KO", "PEP", "MCD", "NKE", "SBUX", "DIS", "WMT", "COST", "HD", "TGT",
    "LOW", "ABNB", "MAR", "CMG", "YUM",
    # ===== US REAL ESTATE / UTILITIES (10) =====
    "AMT", "PLD", "CCI", "SPG", "O", "NEE", "DUK", "SO", "D", "AEP",
    # ===== US OTHER NOTABLE (10) =====
    "BRK-B", "T", "VZ", "PYPL", "ROKU", "SNAP", "PINS", "HOOD", "SOFI", "RIVN",
    # ===== FRANCE — CAC 40 + MID (25) =====
    "MC.PA", "RMS.PA", "AIR.PA", "SAF.PA", "SU.PA", "TTE.PA", "STM.PA", "DSY.PA",
    "CAP.PA", "BNP.PA", "OR.PA", "KER.PA", "DG.PA", "SAN.PA", "RI.PA", "GLE.PA",
    "HO.PA", "EL.PA", "ACA.PA", "ML.PA", "SGO.PA", "PUB.PA", "BIM.PA", "EDEN.PA",
    "FGR.PA",
    # ===== FRANCE — SMALL/MID TECH (10) =====
    "SOI.PA", "EXA.PA", "EXENS.PA", "OVH.PA", "AM.PA", "SOP.PA", "UBI.PA",
    "ATO.PA", "DIM.PA", "AKE.PA",
    # ===== GERMANY — DAX (20) =====
    "SAP.DE", "SIE.DE", "ALV.DE", "RHM.DE", "ADS.DE", "BMW.DE", "MBG.DE",
    "DTE.DE", "IFX.DE", "MUV2.DE", "BAS.DE", "BAYN.DE", "DBK.DE", "DHL.DE",
    "ENR.DE", "SHL.DE", "VOW3.DE", "EOAN.DE", "RWE.DE", "ZAL.DE",
    # ===== NETHERLANDS (12) =====
    "ASML.AS", "SHEL.AS", "UNA.AS", "PHIA.AS", "INGA.AS", "HEIA.AS",
    "PRX.AS", "WKL.AS", "ADYEN.AS", "BESI.AS", "ASM.AS", "MT.AS",
    # ===== ITALY (10) =====
    "RACE.MI", "ENEL.MI", "ENI.MI", "ISP.MI", "UCG.MI", "MONC.MI",
    "LDO.MI", "BC.MI", "PRY.MI", "FBK.MI",
    # ===== SPAIN (8) =====
    "ITX.MC", "SAN.MC", "BBVA.MC", "IBE.MC", "TEF.MC", "AMS.MC", "FER.MC", "CLNX.MC",
    # ===== BELGIUM (5) =====
    "ABI.BR", "UCB.BR", "KBC.BR", "SOF.BR", "MELE.BR",
    # ===== NORDICS (15) =====
    "NOVO-B.CO", "VWS.CO", "ORSTED.CO", "DSV.CO", "GMAB.CO",
    "NOKIA.HE", "KNEBV.HE", "NESTE.HE", "SAMPO.HE", "FORTUM.HE",
    "ERIC-B.ST", "VOLV-B.ST", "ATCO-A.ST", "EVO.ST", "HM-B.ST",
    # ===== SWITZERLAND (8) =====
    "NESN.SW", "NOVN.SW", "ROG.SW", "UBSG.SW", "CFR.SW", "LONN.SW", "GIVN.SW", "ZURN.SW",
    # ===== PORTUGAL + IRELAND (4) =====
    "EDP.LS", "GALP.LS", "RYA.IR", "CRH.L",
]

# Cache
_rankings_cache: Dict[str, Any] = {
    "long_term": [],
    "short_term": [],
    "last_updated": None,
    "computing": False,
}


def _compute_single_score(ticker: str) -> dict:
    """Compute both long-term and short-term scores for a single ticker. Lightweight."""
    result = {
        "ticker": ticker,
        "name": "",
        "price": None,
        "change_pct": None,
        "currency": "USD",
        "long_term_score": None,
        "long_term_verdict": "",
        "short_term_score": None,
        "short_term_verdict": "",
        "pe_ratio": None,
        "revenue_growth": None,
        "rsi": None,
    }

    try:
        t = yf.Ticker(ticker)
        info = t.info or {}

        result["name"] = info.get("shortName", "") or info.get("longName", "") or ticker
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        prev = info.get("previousClose")
        result["currency"] = info.get("currency", "USD")

        if price:
            result["price"] = round(float(price), 2)
            if prev and prev > 0:
                result["change_pct"] = round(((price - prev) / prev) * 100, 2)

        result["pe_ratio"] = info.get("trailingPE")
        rg = info.get("revenueGrowth")
        if rg is not None:
            result["revenue_growth"] = round(float(rg) * 100, 1)

        # Quick technicals
        hist = t.history(period="3mo")
        if not hist.empty and len(hist) >= 14:
            closes = hist["Close"].values
            if len(closes) >= 50:
                ma50 = float(np.mean(closes[-50:]))
            else:
                ma50 = None
            rsi_val = compute_rsi(closes, period=14)
            result["rsi"] = round(rsi_val, 1) if rsi_val else None
    except Exception:
        pass

    # Compute long-term score
    try:
        vdata = verdict(ticker)
        if isinstance(vdata, dict):
            result["long_term_score"] = round(vdata.get("composite_score", 0))
            result["long_term_verdict"] = vdata.get("verdict", "")
    except Exception:
        pass

    # Compute short-term score
    try:
        stdata = short_term_verdict(ticker)
        if isinstance(stdata, dict):
            result["short_term_score"] = round(stdata.get("composite_score", 0))
            result["short_term_verdict"] = stdata.get("verdict", "")
    except Exception:
        pass

    return _sanitize(result)


def _refresh_rankings():
    """Background task to compute rankings for all stocks in universe."""
    if _rankings_cache["computing"]:
        return
    _rankings_cache["computing"] = True

    results = []
    # Process in small batches to avoid API rate limits
    batch_size = 8
    for i in range(0, len(RANKINGS_UNIVERSE), batch_size):
        batch = RANKINGS_UNIVERSE[i : i + batch_size]
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {executor.submit(_compute_single_score, t): t for t in batch}
            for future in as_completed(futures):
                try:
                    r = future.result()
                    if r and (r["long_term_score"] is not None or r["short_term_score"] is not None):
                        results.append(r)
                except Exception:
                    pass
        # Small delay between batches to respect rate limits
        _time.sleep(1)

    # Sort and cache
    long_term = sorted(
        [r for r in results if r["long_term_score"] is not None],
        key=lambda x: x["long_term_score"],
        reverse=True,
    )[:15]

    short_term = sorted(
        [r for r in results if r["short_term_score"] is not None],
        key=lambda x: x["short_term_score"],
        reverse=True,
    )[:15]

    _rankings_cache["long_term"] = long_term
    _rankings_cache["short_term"] = short_term
    _rankings_cache["last_updated"] = datetime.datetime.now().isoformat()
    _rankings_cache["computing"] = False


# --- Politician / Congressional Trades ---

from bs4 import BeautifulSoup
import re as _re

_congress_cache: Dict[str, Any] = {
    "trades": [],
    "last_fetched": None,
}


def _scrape_capitol_trades(pages: int = 5) -> list:
    """Scrape recent trades from Capitol Trades."""
    all_trades = []
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

    for page in range(1, pages + 1):
        try:
            url = f"https://www.capitoltrades.com/trades?page={page}&pageSize=96"
            r = requests.get(url, headers=headers, timeout=20)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            table = soup.find("table")
            if not table:
                continue
            rows = table.find_all("tr")[1:]  # skip header
            for row in rows:
                cells = row.find_all("td")
                if len(cells) < 9:
                    continue

                # Politician
                pol_cell = cells[0]
                pol_div = pol_cell.find("div", class_=lambda c: c and "cell--politician" in c)
                pol_name_el = pol_div.find("h2") if pol_div else pol_cell.find("h2")
                pol_name = ""
                if pol_name_el:
                    a_tag = pol_name_el.find("a")
                    pol_name = a_tag.get_text(strip=True) if a_tag else pol_name_el.get_text(strip=True)
                party_el = pol_cell.find("span", class_=lambda c: c and any("party" in x for x in (c if isinstance(c, list) else [c])))
                party = party_el.get_text(strip=True) if party_el else ""
                chamber_el = pol_cell.find("span", class_=lambda c: c and any("chamber" in x for x in (c if isinstance(c, list) else [c])))
                chamber = chamber_el.get_text(strip=True) if chamber_el else ""
                state_el = pol_cell.find("span", class_=lambda c: c and any("us-state" in x for x in (c if isinstance(c, list) else [c])))
                state = state_el.get_text(strip=True) if state_el else ""

                # Issuer / Ticker
                issuer_cell = cells[1]
                issuer_h3 = issuer_cell.find("h3") or issuer_cell.find("h2")
                issuer_name = ""
                if issuer_h3:
                    a_tag = issuer_h3.find("a")
                    issuer_name = a_tag.get_text(strip=True) if a_tag else issuer_h3.get_text(strip=True)
                ticker = ""
                issuer_spans = issuer_cell.find_all("span")
                for s in issuer_spans:
                    txt = s.get_text(strip=True)
                    if txt and ":" in txt and txt != "N/A":
                        ticker = txt.split(":")[0]
                    elif txt and txt.isupper() and 1 <= len(txt) <= 5 and txt != "N/A":
                        ticker = txt

                # Skip non-stock trades (bonds, treasury, etc.)
                if not ticker or ticker == "N/A":
                    continue

                # Dates
                pub_date = cells[2].get_text(strip=True).replace("\n", " ")
                trade_date = cells[3].get_text(strip=True).replace("\n", " ")
                # Clean dates: "28 Mar2026" -> "2026-03-28"
                trade_date_clean = _parse_ct_date(trade_date)
                pub_date_clean = _parse_ct_date(pub_date)

                # Type, Size
                trade_type = cells[6].get_text(strip=True).lower()
                amount = cells[7].get_text(strip=True)

                all_trades.append({
                    "politician": pol_name,
                    "party": party,
                    "chamber": chamber,
                    "state": state,
                    "ticker": ticker.upper(),
                    "asset": issuer_name,
                    "type": trade_type,
                    "amount": amount,
                    "transaction_date": trade_date_clean,
                    "disclosure_date": pub_date_clean,
                })
        except Exception:
            continue

    return all_trades


def _parse_ct_date(raw: str) -> str:
    """Parse Capitol Trades date format like '28 Mar2026' -> '2026-03-28'."""
    months = {
        "Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04",
        "May": "05", "Jun": "06", "Jul": "07", "Aug": "08",
        "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12",
    }
    raw = raw.strip()
    m = _re.match(r"(\d{1,2})\s*([A-Za-z]{3})\s*(\d{4})", raw)
    if m:
        day = m.group(1).zfill(2)
        mon = months.get(m.group(2), "01")
        year = m.group(3)
        return f"{year}-{mon}-{day}"
    return raw


def _fetch_congress_trades():
    """Fetch and cache congressional trades."""
    now = datetime.datetime.now()
    # Cache for 2 hours
    if _congress_cache["last_fetched"]:
        elapsed = (now - datetime.datetime.fromisoformat(_congress_cache["last_fetched"])).total_seconds()
        if elapsed < 7200 and _congress_cache["trades"]:
            return

    trades = _scrape_capitol_trades(pages=5)
    if trades:
        _congress_cache["trades"] = trades
    _congress_cache["last_fetched"] = now.isoformat()


@app.get("/congress-trades")
def get_congress_trades(ticker: str = None):
    """Get recent congressional stock trades. Optional ticker filter."""
    _fetch_congress_trades()

    all_trades = list(_congress_cache["trades"])

    if ticker:
        ticker_upper = ticker.upper()
        all_trades = [t for t in all_trades if t["ticker"] == ticker_upper]

    # Sort by transaction date descending
    all_trades.sort(key=lambda x: x.get("transaction_date", ""), reverse=True)

    # Stats
    purchases = [t for t in all_trades if t.get("type") == "buy"]
    sales = [t for t in all_trades if "sell" in t.get("type", "")]

    return _sanitize({
        "trades": all_trades[:100],
        "total": len(all_trades),
        "purchases": len(purchases),
        "sales": len(sales),
        "ticker_filter": ticker,
    })


@app.get("/congress-trades/top-bought")
def get_congress_top_bought():
    """Get the most bought stocks by politicians recently."""
    _fetch_congress_trades()

    all_trades = _congress_cache["trades"]
    purchases = [t for t in all_trades if t.get("type") == "buy"]

    # Count purchases per ticker
    ticker_counts: Dict[str, Dict] = {}
    for t in purchases:
        tk = t["ticker"]
        if tk not in ticker_counts:
            ticker_counts[tk] = {"ticker": tk, "asset": t["asset"], "count": 0, "politicians": set(), "latest_date": ""}
        ticker_counts[tk]["count"] += 1
        ticker_counts[tk]["politicians"].add(t["politician"])
        if t["transaction_date"] > ticker_counts[tk]["latest_date"]:
            ticker_counts[tk]["latest_date"] = t["transaction_date"]

    results = []
    for tk, data in ticker_counts.items():
        results.append({
            "ticker": data["ticker"],
            "asset": data["asset"],
            "purchase_count": data["count"],
            "unique_politicians": len(data["politicians"]),
            "politicians": list(data["politicians"])[:5],
            "latest_date": data["latest_date"],
        })

    results.sort(key=lambda x: x["purchase_count"], reverse=True)
    return _sanitize({"top_bought": results[:20]})


@app.get("/rankings")
def get_rankings():
    """Get pre-computed top 15 long-term and short-term buys."""
    return {
        "long_term": _rankings_cache["long_term"],
        "short_term": _rankings_cache["short_term"],
        "last_updated": _rankings_cache["last_updated"],
        "computing": _rankings_cache["computing"],
        "universe_size": len(RANKINGS_UNIVERSE),
    }


@app.post("/rankings/refresh")
def refresh_rankings():
    """Trigger a background refresh of rankings."""
    if _rankings_cache["computing"]:
        return {"status": "already_computing"}
    thread = threading.Thread(target=_refresh_rankings, daemon=True)
    thread.start()
    return {"status": "started", "universe_size": len(RANKINGS_UNIVERSE)}


def _auto_refresh_loop():
    """Automatically refresh rankings every 30 minutes during market hours."""
    while True:
        _time.sleep(30 * 60)  # 30 minutes
        now = datetime.datetime.now()
        # Only auto-refresh on weekdays between 6am-10pm (covers US + EU markets)
        if now.weekday() < 5 and 6 <= now.hour <= 22:
            _refresh_rankings()


@app.on_event("startup")
def startup_event():
    """Start computing rankings in background on server startup."""
    thread = threading.Thread(target=_refresh_rankings, daemon=True)
    thread.start()
    # Start auto-refresh loop
    auto_thread = threading.Thread(target=_auto_refresh_loop, daemon=True)
    auto_thread.start()


# =====================================================================
# INSTITUTIONAL RESEARCH — High-Optionality Compounder Screener
# Screens mid-caps ($2B–$15B) for early-stage Amazon/Nvidia traits
# =====================================================================

SCREENER_SECTORS = {
    "AI Infrastructure": [
        "PATH", "AI", "SOUN", "BBAI", "BIGB", "AMBA", "CEVA", "BRZE",
        "MDAI", "SMCI",
    ],
    "Cybersecurity AI": [
        "S", "CRWD", "ZS", "RBRK", "QLYS", "TENB", "VRNS", "CYBR",
        "RPD", "OKTA",
    ],
    "Robotics & Automation": [
        "ISRG", "TER", "IRBT", "BRKS", "NOVT", "OUST", "AEVA", "LAZR",
        "ACHR", "JOBY",
    ],
    "Edge Computing & IoT": [
        "NET", "ANET", "LITE", "CALX", "SLAB", "PI", "IOTG", "CIEN",
        "NTGR", "UI",
    ],
    "Synthetic Biology & Genomics": [
        "TXG", "BEAM", "CRSP", "NTLA", "VERV", "RXRX", "TWST", "DNA",
        "SDGR", "ABCL",
    ],
    "Space & Defense Tech": [
        "RKLB", "ASTS", "LUNR", "RDW", "MNTS", "BKSY", "SPIR", "PL",
        "LDOS", "KTOS",
    ],
    "Fintech Infrastructure": [
        "SOFI", "HOOD", "AFRM", "BILL", "TOST", "FLYW", "PAYO", "SHOP",
        "FOUR", "MQ",
    ],
    "Clean Energy & Grid": [
        "ENPH", "SEDG", "RUN", "NOVA", "STEM", "CHPT", "BLNK", "QS",
        "FREY", "PTRA",
    ],
}

# Flatten for the full screener universe
SCREENER_UNIVERSE = []
for _sector_tickers in SCREENER_SECTORS.values():
    SCREENER_UNIVERSE.extend(_sector_tickers)

_screener_cache: Dict[str, Any] = {
    "results": [],
    "last_computed": None,
    "computing": False,
}


def _screen_single_compounder(ticker: str, sector: str) -> Optional[dict]:
    """Deep-screen a single stock for compounder characteristics."""
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}

        market_cap = info.get("marketCap")
        if not market_cap:
            return None

        mcap_b = market_cap / 1e9
        name = info.get("shortName", "") or info.get("longName", "") or ticker
        currency = info.get("currency", "USD")
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        prev_close = info.get("previousClose")

        # ---- Hard Filters ----

        # Revenue & Growth
        total_revenue = info.get("totalRevenue", 0) or 0
        revenue_growth = info.get("revenueGrowth")  # YoY as decimal
        rev_growth_pct = round(revenue_growth * 100, 1) if revenue_growth else None

        # R&D / Revenue ratio
        # yfinance: researchDevelopment from financials
        rd_expense = None
        try:
            fins = t.financials
            if fins is not None and not fins.empty:
                for col_name in ["Research Development", "Research And Development", "ResearchAndDevelopment"]:
                    if col_name in fins.index:
                        vals = fins.loc[col_name].dropna()
                        if len(vals) > 0:
                            rd_expense = float(vals.iloc[0])
                        break
        except Exception:
            pass

        rd_ratio = None
        if rd_expense and total_revenue and total_revenue > 0:
            rd_ratio = round((abs(rd_expense) / total_revenue) * 100, 1)

        # Free Cash Flow margin
        fcf = info.get("freeCashflow")
        fcf_margin = None
        if fcf is not None and total_revenue and total_revenue > 0:
            fcf_margin = round((fcf / total_revenue) * 100, 1)

        # Rule of 40 = Revenue Growth % + FCF Margin %
        rule_of_40 = None
        if rev_growth_pct is not None and fcf_margin is not None:
            rule_of_40 = round(rev_growth_pct + fcf_margin, 1)

        # Operating margin & Gross margin
        op_margin = info.get("operatingMargins")
        op_margin_pct = round(op_margin * 100, 1) if op_margin else None
        gross_margin = info.get("grossMargins")
        gross_margin_pct = round(gross_margin * 100, 1) if gross_margin else None

        # SG&A trend (quarterly) — check for operating leverage
        sga_trend = None
        sga_improving = False
        try:
            q_fins = t.quarterly_financials
            if q_fins is not None and not q_fins.empty:
                sga_row = None
                for row_name in ["Selling General Administrative", "SellingGeneralAdministrative",
                                 "Selling General And Administrative", "SellingGeneralAndAdministration"]:
                    if row_name in q_fins.index:
                        sga_row = q_fins.loc[row_name]
                        break
                rev_row = None
                for row_name in ["Total Revenue", "TotalRevenue"]:
                    if row_name in q_fins.index:
                        rev_row = q_fins.loc[row_name]
                        break
                if sga_row is not None and rev_row is not None:
                    sga_pcts = []
                    for col in q_fins.columns[:4]:  # Last 4 quarters
                        s = sga_row.get(col)
                        r = rev_row.get(col)
                        if s and r and r > 0:
                            sga_pcts.append(round(abs(float(s)) / float(r) * 100, 1))
                    if len(sga_pcts) >= 3:
                        sga_trend = sga_pcts  # Most recent first
                        # Improving = each quarter SGA% <= previous (or roughly stable)
                        sga_improving = all(sga_pcts[i] <= sga_pcts[i + 1] + 0.5 for i in range(len(sga_pcts) - 1))
        except Exception:
            pass

        # Magic Number: [(Rev.Q - Rev.Q-1) * 4] / Sales&Mkt.Q-1
        magic_number = None
        try:
            q_fins = t.quarterly_financials
            if q_fins is not None and not q_fins.empty:
                rev_vals = []
                for row_name in ["Total Revenue", "TotalRevenue"]:
                    if row_name in q_fins.index:
                        for col in q_fins.columns[:3]:
                            v = q_fins.loc[row_name, col]
                            if v and not np.isnan(float(v)):
                                rev_vals.append(float(v))
                        break
                sga_vals = []
                for row_name in ["Selling General Administrative", "SellingGeneralAdministrative",
                                 "Selling General And Administrative", "SellingGeneralAndAdministration"]:
                    if row_name in q_fins.index:
                        for col in q_fins.columns[:3]:
                            v = q_fins.loc[row_name, col]
                            if v and not np.isnan(float(v)):
                                sga_vals.append(abs(float(v)))
                        break
                if len(rev_vals) >= 2 and len(sga_vals) >= 2:
                    rev_delta = (rev_vals[0] - rev_vals[1]) * 4
                    if sga_vals[1] > 0:
                        magic_number = round(rev_delta / sga_vals[1], 2)
        except Exception:
            pass

        # Insider Ownership
        insider_pct = info.get("heldPercentInsiders")
        insider_pct_val = round(insider_pct * 100, 1) if insider_pct else None

        # Institutional Ownership
        inst_pct = info.get("heldPercentInstitutions")
        inst_pct_val = round(inst_pct * 100, 1) if inst_pct else None

        # Cash runway
        cash = info.get("totalCash", 0) or 0
        op_cashflow = info.get("operatingCashflow")
        cash_runway_q = None
        if op_cashflow and op_cashflow < 0 and cash > 0:
            # Burning cash — how many quarters?
            quarterly_burn = abs(op_cashflow) / 4
            cash_runway_q = round(cash / quarterly_burn, 1) if quarterly_burn > 0 else None
        elif op_cashflow and op_cashflow > 0:
            cash_runway_q = 999  # Self-funding

        # PE & Forward PE
        pe = info.get("trailingPE")
        fwd_pe = info.get("forwardPE")

        # ---- Scoring System ----
        # Sanity checks for pre-revenue / early-stage companies
        is_pre_revenue = total_revenue and total_revenue > 0 and rd_ratio is not None and rd_ratio > 100
        # Cap extreme values for scoring (keep raw for display)
        rd_ratio_score = min(rd_ratio, 60) if rd_ratio else None
        rule_of_40_score = rule_of_40 if rule_of_40 is not None and -100 < rule_of_40 < 200 else None

        score = 0
        max_score = 0
        flags = []

        # Market cap context
        if mcap_b >= 2 and mcap_b <= 15:
            flags.append(f"Mid-Cap Sweet Spot (${mcap_b:.1f}B)")

        # R&D intensity (20 pts) — capped at 60% for scoring
        max_score += 20
        if rd_ratio_score is not None and not is_pre_revenue:
            if rd_ratio_score >= 25:
                score += 20
                flags.append("Elite R&D (>25%)")
            elif rd_ratio_score >= 18:
                score += 15
                flags.append("High R&D (>18%)")
            elif rd_ratio_score >= 12:
                score += 8
        elif is_pre_revenue:
            # Pre-revenue: cap at 10 pts — R&D is high but business unproven
            score += 10
            flags.append("Pre-Revenue: High R&D (unproven)")

        # Rule of 40 (20 pts) — only score if reasonable range
        max_score += 20
        if rule_of_40_score is not None:
            if rule_of_40_score >= 60:
                score += 20
                flags.append("Rule of 40: Exceptional")
            elif rule_of_40_score >= 40:
                score += 15
                flags.append("Rule of 40: PASS")
            elif rule_of_40_score >= 25:
                score += 8
            elif rule_of_40_score >= 10:
                score += 4

        # Magic Number (15 pts)
        max_score += 15
        if magic_number is not None:
            if magic_number >= 1.0:
                score += 15
                flags.append("Magic Number >1.0: Hyper-efficient")
            elif magic_number >= 0.75:
                score += 12
                flags.append("Magic Number >0.75: Efficient")
            elif magic_number >= 0.5:
                score += 6

        # SG&A Operating Leverage (10 pts)
        max_score += 10
        if sga_improving:
            score += 10
            flags.append("Operating Leverage: SG&A declining")

        # Insider Ownership (10 pts)
        max_score += 10
        if insider_pct_val is not None:
            if insider_pct_val >= 15:
                score += 10
                flags.append(f"Founder-led Premium ({insider_pct_val}%)")
            elif insider_pct_val >= 10:
                score += 8
                flags.append(f"Strong Insider Alignment ({insider_pct_val}%)")
            elif insider_pct_val >= 5:
                score += 4

        # Revenue Growth (15 pts)
        max_score += 15
        if rev_growth_pct is not None:
            if rev_growth_pct >= 40:
                score += 15
                flags.append(f"Hypergrowth ({rev_growth_pct}% YoY)")
            elif rev_growth_pct >= 25:
                score += 12
            elif rev_growth_pct >= 15:
                score += 8
            elif rev_growth_pct >= 5:
                score += 4

        # Gross Margin quality (10 pts)
        max_score += 10
        if gross_margin_pct is not None:
            if gross_margin_pct >= 70:
                score += 10
                flags.append("Software-grade margins")
            elif gross_margin_pct >= 55:
                score += 7
            elif gross_margin_pct >= 40:
                score += 4

        final_score = round((score / max_score) * 100) if max_score > 0 else 0

        # Determine verdict
        if final_score >= 75:
            verdict = "STRONG COMPOUNDER"
        elif final_score >= 60:
            verdict = "HIGH POTENTIAL"
        elif final_score >= 45:
            verdict = "WATCH — EMERGING"
        elif final_score >= 30:
            verdict = "EARLY STAGE"
        else:
            verdict = "INSUFFICIENT"

        return {
            "ticker": ticker,
            "name": name,
            "sector": sector,
            "price": round(float(price), 2) if price else None,
            "change_pct": round(((price - prev_close) / prev_close) * 100, 2) if price and prev_close and prev_close > 0 else None,
            "currency": currency,
            "market_cap_b": round(mcap_b, 2),
            "score": final_score,
            "verdict": verdict,
            "flags": flags,
            "metrics": {
                "rd_ratio": rd_ratio,
                "revenue_growth": rev_growth_pct,
                "rule_of_40": rule_of_40,
                "magic_number": magic_number,
                "fcf_margin": fcf_margin,
                "gross_margin": gross_margin_pct,
                "op_margin": op_margin_pct,
                "insider_pct": insider_pct_val,
                "institutional_pct": inst_pct_val,
                "pe": round(pe, 1) if pe else None,
                "forward_pe": round(fwd_pe, 1) if fwd_pe else None,
                "sga_trend": sga_trend,
                "sga_improving": sga_improving,
                "cash_runway_quarters": cash_runway_q,
                "total_cash_b": round(cash / 1e9, 2) if cash else None,
            },
        }
    except Exception:
        return None


def _run_screener():
    """Run the full compounder screener across all sectors."""
    if _screener_cache["computing"]:
        return
    _screener_cache["computing"] = True

    results = []
    for sector, tickers in SCREENER_SECTORS.items():
        for ticker in tickers:
            try:
                r = _screen_single_compounder(ticker, sector)
                if r:
                    results.append(r)
            except Exception:
                pass
            _time.sleep(0.5)  # Rate limit respect

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    _screener_cache["results"] = results
    _screener_cache["last_computed"] = datetime.datetime.now().isoformat()
    _screener_cache["computing"] = False


@app.get("/screener")
def get_screener():
    """Get compounder screener results."""
    return _sanitize({
        "results": _screener_cache["results"],
        "last_computed": _screener_cache["last_computed"],
        "computing": _screener_cache["computing"],
        "universe_size": len(SCREENER_UNIVERSE),
        "sectors": list(SCREENER_SECTORS.keys()),
    })


@app.post("/screener/run")
def run_screener():
    """Trigger screener computation in background."""
    if _screener_cache["computing"]:
        return {"status": "already_computing"}
    thread = threading.Thread(target=_run_screener, daemon=True)
    thread.start()
    return {"status": "started", "universe_size": len(SCREENER_UNIVERSE)}


@app.get("/screener/{ticker}")
def screen_single(ticker: str):
    """Screen a single stock with the compounder methodology."""
    ticker = resolve_ticker(ticker)
    # Find its sector
    sector = "Other"
    for s, tickers in SCREENER_SECTORS.items():
        if ticker in tickers:
            sector = s
            break
    result = _screen_single_compounder(ticker, sector)
    if not result:
        raise HTTPException(status_code=404, detail=f"Could not screen {ticker}")
    return _sanitize(result)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
