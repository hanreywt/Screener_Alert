export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT"] as const;
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
  minStrengthAlert: 55,

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
};

// Binance public REST mirrors (some regions block api.binance.com).
export const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://api-gcp.binance.com",
  "https://data-api.binance.vision",
];
