"""Support/Resistance zone detection and strength scoring.

Pipeline:
  1. Find swing pivots (fractals) -> raw candidate levels.
  2. Cluster nearby pivots + volume nodes into zones.
  3. Score each zone 0-100 on volume, touches, rejection, confluence, recency.
"""
from __future__ import annotations
from dataclasses import dataclass, field
import numpy as np
import pandas as pd

import config
from volume_profile import VolumeProfile, volume_at_price


@dataclass
class Zone:
    price: float                 # zone center
    lo: float                    # band low
    hi: float                    # band high
    kind: str                    # "support" | "resistance"
    strength: float = 0.0        # composite 0-100
    touches: int = 0
    components: dict = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)  # POC / VAH / HVN ...

    def contains(self, price: float) -> bool:
        return self.lo <= price <= self.hi


def _swing_pivots(df: pd.DataFrame, k: int):
    """Fractal swing highs and lows with k bars of confirmation each side."""
    highs, lows = [], []
    h, l = df["high"].values, df["low"].values
    t = df.index
    for i in range(k, len(df) - k):
        win_h = h[i - k:i + k + 1]
        win_l = l[i - k:i + k + 1]
        if h[i] == win_h.max() and (win_h.argmax() == k):
            highs.append((t[i], h[i]))
        if l[i] == win_l.min() and (win_l.argmin() == k):
            lows.append((t[i], l[i]))
    return highs, lows


def _rejection_at(df: pd.DataFrame, lo: float, hi: float, atr: float) -> float:
    """Mean ATR-normalized wick rejection for candles that tested the band."""
    rej = []
    for _, r in df.iterrows():
        if r["low"] <= hi and r["high"] >= lo:  # candle overlapped the zone
            body_hi = max(r["open"], r["close"])
            body_lo = min(r["open"], r["close"])
            upper_wick = r["high"] - body_hi
            lower_wick = body_lo - r["low"]
            rej.append(max(upper_wick, lower_wick))
    if not rej or atr <= 0:
        return 0.0
    return float(np.clip(np.mean(rej) / atr, 0, 1))


def detect_zones(df: pd.DataFrame, profile: VolumeProfile, atr: float,
                 price: float) -> list[Zone]:
    highs, lows = _swing_pivots(df, config.PIVOT_LOOKBACK)

    # Seed candidate levels: pivots + key volume-profile prices.
    candidates = []  # (price, time_or_None, source)
    for t, p in highs:
        candidates.append((p, t, "pivot"))
    for t, p in lows:
        candidates.append((p, t, "pivot"))
    for p, tag in [(profile.poc, "POC"), (profile.vah, "VAH"),
                   (profile.val, "VAL")]:
        candidates.append((p, None, tag))
    for p in profile.hvns:
        candidates.append((p, None, "HVN"))

    candidates.sort(key=lambda x: x[0])
    tol = config.CLUSTER_ATR_MULT * atr

    # Agglomerate candidates that sit within `tol` of each other.
    clusters: list[list] = []
    for c in candidates:
        if clusters and abs(c[0] - np.mean([x[0] for x in clusters[-1]])) <= tol:
            clusters[-1].append(c)
        else:
            clusters.append([c])

    last_time = df.index[-1]
    span = (last_time - df.index[0]).total_seconds() or 1.0
    zones: list[Zone] = []

    for cl in clusters:
        prices = [x[0] for x in cl]
        center = float(np.mean(prices))
        half = config.ZONE_WIDTH_ATR * atr
        lo, hi = center - half, center + half
        kind = "resistance" if center >= price else "support"

        tags = sorted({x[2] for x in cl if x[2] not in ("pivot",)})
        touches = sum(1 for x in cl if x[2] == "pivot")

        # --- component scores (each 0-1) ---
        vol_s = volume_at_price(profile, center)
        touch_s = min(touches / 4.0, 1.0)
        rej_s = _rejection_at(df, lo, hi, atr)
        conf_s = min(len(tags) / 3.0, 1.0)
        # recency: most recent pivot time in the cluster, time-decayed
        times = [x[1] for x in cl if x[1] is not None]
        if times:
            newest = max(times)
            recency_s = float((newest - df.index[0]).total_seconds() / span)
        else:
            recency_s = 0.5
        recency_s = np.clip(recency_s, 0, 1)

        w = config.WEIGHTS
        strength = 100 * (
            w["volume"] * vol_s +
            w["touches"] * touch_s +
            w["rejection"] * rej_s +
            w["confluence"] * conf_s +
            w["recency"] * recency_s
        )

        zones.append(Zone(
            price=round(center, 6), lo=round(lo, 6), hi=round(hi, 6),
            kind=kind, strength=round(strength, 1), touches=touches,
            tags=tags,
            components={
                "volume": round(vol_s, 2), "touches": round(touch_s, 2),
                "rejection": round(rej_s, 2), "confluence": round(conf_s, 2),
                "recency": round(recency_s, 2),
            },
        ))

    zones.sort(key=lambda z: z.strength, reverse=True)
    return zones
