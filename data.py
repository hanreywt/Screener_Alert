"""Realtime market data from Binance public REST (no API key required)."""
from __future__ import annotations
import time
import requests
import pandas as pd

try:
    import certifi
    _CA = certifi.where()
except ImportError:
    _CA = True

import config

# Binance mirrors — try in order (some regions block api.binance.com).
_HOSTS = [
    config.BINANCE_BASE,
    "https://api-gcp.binance.com",
    "https://data-api.binance.vision",
]

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "quant-sr-engine/1.0"})
_SESSION.verify = _CA


def _get(path: str, params: dict, timeout: int = 10):
    """GET against Binance, failing over across mirror hosts."""
    last = None
    for host in _HOSTS:
        try:
            r = _SESSION.get(host + path, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            continue
    raise RuntimeError(str(last))


def get_klines(symbol: str, interval: str, limit: int) -> pd.DataFrame:
    """Fetch OHLCV candles. Returns a DataFrame indexed by open time (UTC)."""
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    try:
        raw = _get("/api/v3/klines", params)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"{symbol} klines failed: {e}") from e

    cols = ["open_time", "open", "high", "low", "close", "volume",
            "close_time", "quote_volume", "trades", "taker_base",
            "taker_quote", "ignore"]
    df = pd.DataFrame(raw, columns=cols)
    for c in ["open", "high", "low", "close", "volume", "quote_volume"]:
        df[c] = df[c].astype(float)
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    df["close_time"] = pd.to_datetime(df["close_time"], unit="ms", utc=True)
    df = df.set_index("open_time")
    # Drop the still-forming last candle for structural calcs; callers that
    # want the live price use get_price().
    return df[["open", "high", "low", "close", "volume", "quote_volume",
               "trades", "close_time"]]


def get_price(symbol: str) -> float:
    """Latest traded price."""
    return float(_get("/api/v3/ticker/price", {"symbol": symbol})["price"])


def atr(df: pd.DataFrame, period: int = 14) -> float:
    """Average True Range on the given candles."""
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return float(tr.rolling(period).mean().iloc[-1])
