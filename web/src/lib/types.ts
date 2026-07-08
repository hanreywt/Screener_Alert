export interface Candle {
  time: number; // unix seconds (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  winrateNote?: string;
}

export interface Analysis {
  symbol: string;
  price: number;
  atr: number;
  updatedAt: number;
  candles: Candle[];
  profile: VolumeProfile;
  zones: Zone[];
  signals: Signal[];
}
