"""Realtime quant support/resistance engine.

Loop:
  for each symbol -> pull HTF candles -> build volume profile ->
  detect & score zones -> pull LTF candles -> evaluate break/retest/watch
  -> dispatch alerts. Repeats every POLL_SECONDS.

Run once with --scan to print the current zone map and exit.
"""
from __future__ import annotations
import argparse
import time
from datetime import datetime, timezone

import config
import data
from volume_profile import build_profile
from zones import detect_zones
from signals import evaluate
from alerts import dispatch, _bar

# persistent flipped-zone memory per symbol, survives across polls
_BROKEN: dict[str, dict] = {s: {} for s in config.SYMBOLS}
# de-dupe: don't re-fire identical alerts every 30s
_SEEN: dict[str, float] = {}
_SEEN_TTL = 900  # seconds


def analyze(symbol: str):
    struct = data.get_klines(symbol, config.STRUCT_TF, config.STRUCT_LOOKBACK)
    trig = data.get_klines(symbol, config.TRIGGER_TF, config.TRIGGER_LOOKBACK)
    price = data.get_price(symbol)
    atr = data.atr(struct)
    profile = build_profile(struct)
    zones = detect_zones(struct, profile, atr, price)
    return price, atr, profile, zones, trig


def print_scan(symbol: str):
    price, atr, profile, zones, _ = analyze(symbol)
    print(f"\n=== {symbol}  price {price}  ATR {atr:.4f} ===")
    print(f"POC {profile.poc:.4f} | VAH {profile.vah:.4f} | "
          f"VAL {profile.val:.4f}")
    print(f"{'ZONE':>14} {'KIND':<11} {'STR':>5}  BAR          TAGS")
    for z in zones[:12]:
        if z.strength < 40:
            continue
        tags = ",".join(z.tags)
        print(f"{z.price:>14.4f} {z.kind:<11} {z.strength:>5.1f}  "
              f"{_bar(z.strength)}  {tags}")


def _dedupe(signals):
    now = time.time()
    fresh = []
    for s in signals:
        key = f"{s.symbol}:{s.kind}:{s.zone.price}"
        if now - _SEEN.get(key, 0) > _SEEN_TTL:
            _SEEN[key] = now
            fresh.append(s)
    return fresh


def run_loop():
    print(f"⚡ Quant S/R engine live — {', '.join(config.SYMBOLS)}")
    print(f"   Struct {config.STRUCT_TF} / Trigger {config.TRIGGER_TF} / "
          f"poll {config.POLL_SECONDS}s\n")
    while True:
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        for symbol in config.SYMBOLS:
            try:
                price, atr, profile, zones, trig = analyze(symbol)
                signals = evaluate(symbol, price, zones, trig, atr,
                                   _BROKEN[symbol])
                signals = _dedupe(signals)
                if signals:
                    print(f"--- {stamp}  {symbol} ---")
                    dispatch(signals)
            except Exception as e:  # noqa: BLE001
                print(f"[{stamp}] {symbol} error: {e}")
        time.sleep(config.POLL_SECONDS)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true",
                    help="print current zone map for all symbols and exit")
    args = ap.parse_args()
    if args.scan:
        for sym in config.SYMBOLS:
            try:
                print_scan(sym)
            except Exception as e:  # noqa: BLE001
                print(f"{sym} error: {e}")
    else:
        run_loop()
