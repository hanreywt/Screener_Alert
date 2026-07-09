export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT", "TAOUSDT"] as const;
export type Symbol = (typeof SYMBOLS)[number];

export const CONFIG = {
  structTf: "1h",
  structLookback: 500,
  triggerTf: "5m",
  triggerLookback: 120,

  profileBins: 100,
  valueAreaPct: 0.7,
  hvnProminence: 0.6,

  pivotLookback: 3,
  clusterAtrMult: 0.6,
  zoneWidthAtr: 0.5,
  minStrengthAlert: 55, // min strength for break/retest signals
  watchMinStrength: 70, // watch (heads-up) only for strong zones — cuts noise

  weights: {
    volume: 0.3,
    touches: 0.22,
    rejection: 0.2,
    confluence: 0.15,
    recency: 0.13,
  },

  breakVolMult: 1.5,
  breakAtrMult: 0.25,
  retestTolAtr: 0.4,
  proximityAtr: 0.8,

  // Regime filter (Kaufman efficiency ratio on the structural timeframe).
  regimeLookback: 20, // bars for the net-vs-path measure
  regimeMinEr: 0.3, // >= this = trending; below = range/chop
};

// Round-number ("psychological") price levels to alert on when crossed.
// Map symbol -> step size; omit a symbol to disable. BTC alerts on every
// $1,000 (62k, 63k, ...). Add ETHUSDT: 100, SOLUSDT: 5, etc. to enable more.
export const ROUND_STEP: Partial<Record<Symbol, number>> = {
  BTCUSDT: 1000,
};

// Hysteresis: fraction of the step price must clear *beyond* a level before a
// cross is confirmed. Suppresses flapping right on the line without blocking
// genuine re-crosses. 0.03 = 3% of the step ($30 on BTC's $1,000). Every real
// cross (up or down, repeated) alerts; only sub-$30 jitter on the line is muted.
export const ROUND_HYSTERESIS = 0.03;

// Binance public REST mirrors (some regions block api.binance.com).
export const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://api-gcp.binance.com",
  "https://data-api.binance.vision",
];
