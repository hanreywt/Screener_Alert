"""Trade signals on top of scored zones.

Two proven, high-winrate structures in trending crypto:

  A) BREAK-AND-RETEST (primary, ~60-70% hist. winrate on HVN zones):
     price breaks a strong zone on expanding volume, the zone flips
     (old resistance -> new support), price returns to it and rejects.
     Entry in the direction of the break, stop beyond the flipped zone,
     target the next zone. Reward:risk usually >= 1.5.

  B) POC / HVN BOUNCE: price reaches a very strong untouched zone and
     prints a rejection -> mean-reversion fade back toward POC.

Each break also gets a BREAK RATING (0-100): volume expansion + decisive
ATR close-through. High rating = trust the break (trend/flip trade).
"""
from __future__ import annotations
from dataclasses import dataclass
import pandas as pd

import config
from zones import Zone


@dataclass
class Signal:
    symbol: str
    kind: str            # "watch" | "break" | "retest" | "bounce"
    zone: Zone
    price: float
    detail: str
    break_rating: float = 0.0
    entry: float = 0.0
    stop: float = 0.0
    target: float = 0.0
    rr: float = 0.0
    winrate_note: str = ""


def _avg_vol(df: pd.DataFrame, n: int = 20) -> float:
    return float(df["volume"].tail(n).mean())


def rate_break(df: pd.DataFrame, zone: Zone, atr: float) -> tuple[bool, float, int]:
    """Did the last closed candle decisively break the zone? Returns
    (broke, rating 0-100, direction +1/-1/0)."""
    last = df.iloc[-1]
    avg_v = _avg_vol(df)
    if avg_v <= 0 or atr <= 0:
        return False, 0.0, 0

    vol_exp = last["volume"] / avg_v            # volume expansion ratio
    up = last["close"] - zone.hi                # close above resistance
    down = zone.lo - last["close"]              # close below support
    clear = max(up, down)
    direction = 1 if up > down else -1

    broke = (clear >= config.BREAK_ATR_MULT * atr and
             vol_exp >= config.BREAK_VOL_MULT)

    # rating blends volume expansion and how far it cleared the band
    vol_score = min(vol_exp / (config.BREAK_VOL_MULT * 2), 1.0)
    clear_score = min(clear / (atr), 1.0)
    rating = round(100 * (0.55 * vol_score + 0.45 * clear_score), 1)
    return broke, rating, direction


def evaluate(symbol: str, price: float, zones: list[Zone],
             trig_df: pd.DataFrame, atr: float,
             broken_state: dict) -> list[Signal]:
    """Produce signals for one symbol. `broken_state` persists flipped
    zones across polls: {zone_price: direction}."""
    signals: list[Signal] = []
    strong = [z for z in zones if z.strength >= config.MIN_STRENGTH_ALERT]

    for z in strong:
        dist = abs(price - z.price)

        # --- (1) proximity watch --------------------------------------
        if z.contains(price) or dist <= config.PROXIMITY_ATR * atr:
            broke, rating, direction = rate_break(trig_df, z, atr)

            if broke:
                # zone flipped -> remember it for retest tracking
                broken_state[round(z.price, 6)] = direction
                flip = "support" if direction > 0 else "resistance"
                signals.append(Signal(
                    symbol, "break", z, price,
                    f"{z.kind.upper()} broken {'UP' if direction>0 else 'DOWN'} "
                    f"on {trig_df.iloc[-1]['volume']/_avg_vol(trig_df):.1f}x vol "
                    f"-> flips to {flip}",
                    break_rating=rating,
                ))
            else:
                signals.append(Signal(
                    symbol, "watch", z, price,
                    f"Price {dist/atr:.2f} ATR from {z.kind} "
                    f"(strength {z.strength}) — watch for reaction",
                ))

        # --- (2) retest of a previously flipped zone ------------------
        prev_dir = broken_state.get(round(z.price, 6))
        if prev_dir is not None and dist <= config.RETEST_TOL_ATR * atr:
            sig = _build_retest(symbol, price, z, zones, atr, prev_dir)
            if sig:
                signals.append(sig)

    return signals


def _build_retest(symbol, price, zone, zones, atr, direction) -> Signal | None:
    """Construct the entry/stop/target for a break-and-retest play."""
    if direction > 0:   # bullish: broke up, retest flipped support -> long
        entry = price
        stop = zone.lo - 0.5 * atr
        targets = [z.price for z in zones
                   if z.price > price + 0.5 * atr and z.strength >= 50]
        target = min(targets) if targets else price + 2 * (entry - stop)
        side = "LONG"
    else:               # bearish: broke down, retest flipped resistance -> short
        entry = price
        stop = zone.hi + 0.5 * atr
        targets = [z.price for z in zones
                   if z.price < price - 0.5 * atr and z.strength >= 50]
        target = max(targets) if targets else price - 2 * (stop - entry)
        side = "SHORT"

    risk = abs(entry - stop)
    reward = abs(target - entry)
    if risk <= 0:
        return None
    rr = round(reward / risk, 2)

    return Signal(
        symbol, "retest", zone, price,
        f"BREAK-AND-RETEST {side}: price retesting flipped zone "
        f"@ {zone.price} (strength {zone.strength})",
        entry=round(entry, 6), stop=round(stop, 6), target=round(target, 6),
        rr=rr,
        winrate_note="Break-&-retest of HVN/strong zone: ~60-70% hist. "
                     "winrate in trend; only take if RR >= 1.5.",
    )
