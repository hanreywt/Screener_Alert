import type { RefLevels } from "./refLevels";

export interface Candle {
  time: number; // unix seconds (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuy?: number; // taker-buy BASE volume (Binance kline field 9); undefined if not fetched
}

export interface VolumeProfile {
  prices: number[];
  volume: number[]; // aligned with prices
  poc: number;
  vah: number;
  val: number;
  hvns: number[];
  lvns: number[];
}

export interface Zone {
  price: number;
  lo: number;
  hi: number;
  kind: "support" | "resistance";
  strength: number; // 0-100
  touches: number;
  tags: string[];
  components: {
    volume: number;
    touches: number;
    rejection: number;
    confluence: number;
    recency: number;
  };
}

export type Regime = "trend_up" | "trend_down" | "range";

export type SignalKind = "watch" | "break" | "retest";

export interface Signal {
  symbol: string;
  kind: SignalKind;
  zonePrice: number;
  zoneKind: "support" | "resistance";
  strength: number;
  price: number;
  detail: string;
  breakRating?: number;
  entry?: number;
  stop?: number;
  target?: number;
  rr?: number;
  /** This symbol's MEASURED forward record, injected at alert time. Never a
   *  claimed or assumed win rate — see config.EDGE_STATUS. */
  recordNote?: string;
  regime?: Regime;
  liqNote?: string; // liquidation-cluster context (informational, no score weight)
  /** Taker buy/sell imbalance context near the level (exhaustion cue). DISPLAY
   *  ONLY — descriptive, never an edge/direction claim. See lib/flow.ts. */
  flowNote?: string;
  /** Value-area position + POC rotation target. DISPLAY ONLY. See lib/flow.ts. */
  rotationNote?: string;
}

export interface Analysis {
  symbol: string;
  price: number;
  atr: number;
  regime: Regime;
  regimeEr: number; // Kaufman efficiency ratio 0..1 (trend cleanliness)
  updatedAt: number;
  candles: Candle[];
  profile: VolumeProfile;
  zones: Zone[];
  signals: Signal[];
  /** Previous day/week high-low. DISPLAY ONLY — never feeds zones or signals.
   *  See lib/refLevels.ts for why. */
  refLevels: RefLevels;
}
