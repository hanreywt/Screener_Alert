"""Volume Profile: Point of Control, Value Area, High/Low Volume Nodes.

This is the 'most-traded zone' engine. Volume from every candle is spread
across the price range it covered, giving a volume-at-price histogram. The
peaks of that histogram are the levels the market defended hardest -> the
strongest structural support/resistance.
"""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np
import pandas as pd

import config


@dataclass
class VolumeProfile:
    prices: np.ndarray      # bin center prices (low -> high)
    volume: np.ndarray      # volume at each bin
    poc: float              # Point of Control (max-volume price)
    vah: float              # Value Area High
    val: float              # Value Area Low
    hvns: list[float]       # High Volume Node prices (strong magnets)
    lvns: list[float]       # Low Volume Node prices (fast-move gaps)


def build_profile(df: pd.DataFrame, bins: int = None) -> VolumeProfile:
    bins = bins or config.PROFILE_BINS
    lo, hi = df["low"].min(), df["high"].max()
    if hi <= lo:
        hi = lo * 1.001
    edges = np.linspace(lo, hi, bins + 1)
    centers = (edges[:-1] + edges[1:]) / 2
    vol = np.zeros(bins)

    # Spread each candle's volume uniformly across the bins it spanned.
    bin_w = edges[1] - edges[0]
    for _, row in df.iterrows():
        c_lo, c_hi, v = row["low"], row["high"], row["volume"]
        if v <= 0:
            continue
        span = max(c_hi - c_lo, bin_w)
        first = int(np.clip((c_lo - lo) / bin_w, 0, bins - 1))
        last = int(np.clip((c_hi - lo) / bin_w, 0, bins - 1))
        n = last - first + 1
        vol[first:last + 1] += v / n * (bin_w * n / span if span else 1)

    poc_idx = int(np.argmax(vol))
    poc = centers[poc_idx]

    # Value Area: expand out from POC until 70% of volume is captured.
    total = vol.sum()
    target = total * config.VALUE_AREA_PCT
    lo_i = hi_i = poc_idx
    captured = vol[poc_idx]
    while captured < target and (lo_i > 0 or hi_i < bins - 1):
        low_v = vol[lo_i - 1] if lo_i > 0 else -1
        high_v = vol[hi_i + 1] if hi_i < bins - 1 else -1
        if high_v >= low_v:
            hi_i += 1
            captured += vol[hi_i]
        else:
            lo_i -= 1
            captured += vol[lo_i]
    val, vah = centers[lo_i], centers[hi_i]

    hvns = _find_nodes(centers, vol, kind="high")
    lvns = _find_nodes(centers, vol, kind="low")
    return VolumeProfile(centers, vol, poc, vah, val, hvns, lvns)


def _find_nodes(centers, vol, kind="high") -> list[float]:
    """Local maxima (HVN) or minima (LVN) of the volume histogram."""
    out = []
    vmax = vol.max() or 1.0
    for i in range(1, len(vol) - 1):
        if kind == "high":
            is_node = vol[i] > vol[i - 1] and vol[i] >= vol[i + 1]
            strong = vol[i] >= config.HVN_PROMINENCE * vmax
        else:
            is_node = vol[i] < vol[i - 1] and vol[i] <= vol[i + 1]
            strong = vol[i] <= (1 - config.HVN_PROMINENCE) * vmax
        if is_node and strong:
            out.append(float(centers[i]))
    return out


def volume_at_price(profile: VolumeProfile, price: float) -> float:
    """Normalized (0-1) traded volume at a given price level."""
    idx = int(np.argmin(np.abs(profile.prices - price)))
    return float(profile.volume[idx] / (profile.volume.max() or 1.0))
