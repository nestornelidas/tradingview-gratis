"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Timeframe } from "@/lib/binance/types";

export type IndicatorKey =
  | "ema20"
  | "ema50"
  | "ema200"
  | "rsi"
  | "macd"
  | "volume"
  | "tunelDomenec"
  | "controlTotalDoc"
  | "multiAvisos";

export type DrawingTool = "cursor" | "hline" | "measure" | "eraser" | "magnet";
export type MagnetStrength = "weak" | "strong";

export interface PriceLine {
  id: string;
  symbol: string;
  price: number;
  color: string;
  lineWidth: number;
}

export const DEFAULT_PRICE_LINE_COLOR = "#2962ff";
export const DEFAULT_PRICE_LINE_WIDTH = 1;

export interface MeasurePoint {
  time: number;
  price: number;
}
export interface MeasureState {
  phase: "idle" | "placing" | "done";
  a: MeasurePoint | null;
  b: MeasurePoint | null;
}
export const INITIAL_MEASURE: MeasureState = { phase: "idle", a: null, b: null };

export interface IndicatorConfig {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  tunelPeriod1: number;
  tunelPeriod2: number;
  controlDocPeriod: number;
  multiAvisosPeriod: number;
}

export const DEFAULT_CONFIG: IndicatorConfig = {
  ema20: 20,
  ema50: 50,
  ema200: 200,
  rsi: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  tunelPeriod1: 34,
  tunelPeriod2: 144,
  controlDocPeriod: 40,
  multiAvisosPeriod: 14,
};

export const INDICATOR_COLORS: Record<IndicatorKey, string> = {
  ema20: "#ffb74d",
  ema50: "#2962ff",
  ema200: "#ab47bc",
  rsi: "#ab47bc",
  macd: "#2962ff",
  volume: "#787b86",
  tunelDomenec: "#00e5ff",
  controlTotalDoc: "#00e676",
  multiAvisos: "#ffea00",
};

export const DEFAULT_WATCHLIST = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "MATICUSDT",
  "AAPL",
  "TSLA",
  "NVDA",
  "SPY",
];

interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  /** Indicator is added to the chart (appears in pill + renders unless hidden) */
  indicators: Record<IndicatorKey, boolean>;
  /** Indicator is hidden (eye icon off) — kept in pill list, just not rendered */
  hidden: Record<IndicatorKey, boolean>;
  /** Periods and parameters for each indicator */
  config: IndicatorConfig;
  watchlist: string[];

  // Ephemeral UI state (not persisted)
  tool: DrawingTool;
  magnetStrength: MagnetStrength;
  priceLines: PriceLine[];
  symbolDialogOpen: boolean;
  /** Indicator settings dialog open (null = closed) */
  settingsTarget: IndicatorKey | null;
  /** Drawn measurements (measure tool), keyed by symbol. Persisted per chart. */
  measureBySymbol: Record<string, MeasureState>;

  // Actions
  setSymbol: (s: string) => void;
  setTimeframe: (t: Timeframe) => void;
  toggleIndicator: (key: IndicatorKey) => void;
  removeIndicator: (key: IndicatorKey) => void;
  toggleHidden: (key: IndicatorKey) => void;
  setConfig: (patch: Partial<IndicatorConfig>) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setTool: (t: DrawingTool) => void;
  setMagnetStrength: (s: MagnetStrength) => void;
  addPriceLine: (
    price: number,
    symbol: string,
    color?: string,
    lineWidth?: number,
  ) => void;
  updatePriceLine: (
    id: string,
    patch: Partial<Pick<PriceLine, "price" | "color" | "lineWidth">>,
  ) => void;
  removePriceLine: (id: string) => void;
  clearPriceLines: (symbol?: string) => void;
  setMeasureForSymbol: (symbol: string, measure: MeasureState) => void;
  clearMeasureForSymbol: (symbol: string) => void;
  setSymbolDialogOpen: (v: boolean) => void;
  setSettingsTarget: (k: IndicatorKey | null) => void;
}

export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      symbol: "BTCUSDT",
      timeframe: "15m" as Timeframe,
      indicators: {
        ema20: true,
        ema50: true,
        ema200: false,
        rsi: true,
        macd: false,
        volume: true,
        tunelDomenec: false,
        controlTotalDoc: false,
        multiAvisos: false,
      },
      hidden: {
        ema20: false,
        ema50: false,
        ema200: false,
        rsi: false,
        macd: false,
        volume: false,
        tunelDomenec: false,
        controlTotalDoc: false,
        multiAvisos: false,
      },
      config: { ...DEFAULT_CONFIG },
      watchlist: DEFAULT_WATCHLIST,
      tool: "cursor",
      magnetStrength: "weak" as MagnetStrength,
      priceLines: [],
      measureBySymbol: {},
      symbolDialogOpen: false,
      settingsTarget: null,

      setSymbol: (symbol) => set({ symbol }),
      setTimeframe: (timeframe) => set({ timeframe }),
      toggleIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: !s.indicators[key] },
          // When re-adding, ensure not hidden
          hidden: !s.indicators[key]
            ? { ...s.hidden, [key]: false }
            : s.hidden,
        })),
      removeIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: false },
          hidden: { ...s.hidden, [key]: false },
        })),
      toggleHidden: (key) =>
        set((s) => ({ hidden: { ...s.hidden, [key]: !s.hidden[key] } })),
      setConfig: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      addToWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.includes(s)
            ? state.watchlist
            : [...state.watchlist, s],
        })),
      removeFromWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.filter((x) => x !== s),
        })),
      setTool: (tool) => set({ tool }),
      setMagnetStrength: (magnetStrength) => set({ magnetStrength }),
      addPriceLine: (price, symbol, color, lineWidth) =>
        set((state) => ({
          priceLines: [
            ...state.priceLines,
            {
              id:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`,
              symbol,
              price,
              color: color ?? DEFAULT_PRICE_LINE_COLOR,
              lineWidth: lineWidth ?? DEFAULT_PRICE_LINE_WIDTH,
            },
          ],
        })),
      updatePriceLine: (id, patch) =>
        set((state) => ({
          priceLines: state.priceLines.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
        })),
      removePriceLine: (id) =>
        set((state) => ({
          priceLines: state.priceLines.filter((p) => p.id !== id),
        })),
      clearPriceLines: (symbol) =>
        set((state) => ({
          priceLines: symbol
            ? state.priceLines.filter((p) => p.symbol !== symbol)
            : [],
        })),
      setMeasureForSymbol: (symbol, measure) =>
        set((state) => ({
          measureBySymbol: { ...state.measureBySymbol, [symbol]: measure },
        })),
      clearMeasureForSymbol: (symbol) =>
        set((state) => {
          const measureBySymbol = { ...state.measureBySymbol };
          delete measureBySymbol[symbol];
          return { measureBySymbol };
        }),
      setSymbolDialogOpen: (symbolDialogOpen) => set({ symbolDialogOpen }),
      setSettingsTarget: (settingsTarget) => set({ settingsTarget }),
    }),
    {
      name: "tv-gratis-chart-state",
      partialize: (s) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        indicators: s.indicators,
        hidden: s.hidden,
        config: s.config,
        watchlist: s.watchlist,
        priceLines: s.priceLines,
        measureBySymbol: s.measureBySymbol,
      }),
    },
  ),
);
