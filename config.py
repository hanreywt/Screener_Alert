"""Configuration for the S/R engine."""
import os


def _load_dotenv() -> None:
    """Load KEY=VALUE lines from a local .env into os.environ (no deps).

    Existing environment variables always win, so an explicit `export`
    still overrides the file. Missing file is a no-op.
    """
    path = os.path.join(os.path.dirname(__file__), ".env")
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key, val = key.strip(), val.strip().strip('"').strip("'")
                os.environ.setdefault(key, val)
    except FileNotFoundError:
        pass


_load_dotenv()

# --- Universe ---------------------------------------------------------------
# Binance USDT-perp/spot symbols. ONDO trades on Binance spot as ONDOUSDT.
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT", "TAOUSDT"]

# --- Timeframes -------------------------------------------------------------
# Zones are built on a higher timeframe (structural), triggers watched on lower.
STRUCT_TF = "1h"      # timeframe used to build the volume profile & zones
STRUCT_LOOKBACK = 500 # number of candles for the profile window
TRIGGER_TF = "5m"     # timeframe used to detect break / retest triggers
TRIGGER_LOOKBACK = 120

# --- Volume profile ---------------------------------------------------------
PROFILE_BINS = 100          # resolution of the volume-at-price histogram
VALUE_AREA_PCT = 0.70       # standard 70% value area (VAH/VAL)
HVN_PROMINENCE = 0.6        # min relative prominence for a High Volume Node

# --- Zone clustering / scoring ---------------------------------------------
PIVOT_LOOKBACK = 3          # fractal strength for swing pivots (bars each side)
CLUSTER_ATR_MULT = 0.6      # pivots within this * ATR merge into one zone
ZONE_WIDTH_ATR = 0.5        # half-width of a zone band, in ATR
MIN_STRENGTH_ALERT = 55     # only surface zones at/above this strength

# Composite strength weights (must sum to 1.0)
WEIGHTS = {
    "volume":    0.30,
    "touches":   0.22,
    "rejection": 0.20,
    "confluence":0.15,
    "recency":   0.13,
}

# --- Break / retest play ----------------------------------------------------
BREAK_VOL_MULT = 1.5        # breakout candle volume must exceed this * avg
BREAK_ATR_MULT = 0.25       # close must clear the zone by this * ATR
RETEST_TOL_ATR = 0.4        # price within this * ATR of flipped zone = retest
PROXIMITY_ATR = 0.8         # "watch this zone" when price within this * ATR

# --- Runtime ----------------------------------------------------------------
POLL_SECONDS = 30           # refresh cadence of the realtime loop
BINANCE_BASE = "https://api.binance.com"

# --- Alerts (optional Telegram) --------------------------------------------
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# --- Alerts (optional Discord) ---------------------------------------------
# Channel webhook URL: Server Settings -> Integrations -> Webhooks -> New.
# Format: https://discord.com/api/webhooks/<id>/<token>
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")
