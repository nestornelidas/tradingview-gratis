"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type LineWidth,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchKlines, getMarket } from "@/lib/market";
import { getBinanceWS } from "@/lib/binance/ws";
import {
  ema,
  rsi,
  macd,
  calculateTunelDomenec,
  calculateControlTotal,
  calculateMultiavisos,
} from "@/lib/indicators";
import type { Candle, Timeframe } from "@/lib/binance/types";
import { FillBand } from "@/lib/chart/fillBand";
import {
  INDICATOR_COLORS,
  INITIAL_MEASURE,
  useChartStore,
  type IndicatorKey,
  type MagnetStrength,
  type MeasureState,
} from "@/lib/store/chart-store";
import { formatPrice, formatVolume } from "@/lib/format";
import { IndicatorPill } from "./IndicatorPill";
import { MeasureOverlay } from "./MeasureOverlay";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// ── Magnet / Snap-to-OHLC ─────────────────────────────────────────────────────
interface SnapPoint {
  x: number; // pixel coordinate
  y: number; // pixel coordinate
  price: number;
  time: number;
}

/**
 * Given the current cursor position, find the nearest OHLC point of the
 * candle under the cursor (and its immediate neighbours).
 * Returns null if snapping should not occur (weak mode + too far away).
 */
function findSnapPoint(
  candles: Candle[],
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
  cursorX: number,
  cursorY: number,
  strength: MagnetStrength,
): SnapPoint | null {
  if (candles.length === 0) return null;

  // Convert cursor pixel x to a logical index
  const logical = chart.timeScale().coordinateToLogical(cursorX);
  if (logical === null) return null;

  const idx = Math.round(logical);
  const candidates: Candle[] = [];
  for (let i = idx - 1; i <= idx + 1; i++) {
    if (i >= 0 && i < candles.length) candidates.push(candles[i]);
  }
  if (candidates.length === 0) return null;

  let best: SnapPoint | null = null;
  let bestDist = Infinity;
  const WEAK_THRESHOLD_PX = 20; // px radius for weak mode

  for (const candle of candidates) {
    const cx = chart.timeScale().timeToCoordinate(candle.time as UTCTimestamp);
    if (cx === null) continue;

    for (const price of [candle.open, candle.high, candle.low, candle.close]) {
      const cy = candleSeries.priceToCoordinate(price);
      if (cy === null) continue;
      const dx = cx - cursorX;
      const dy = cy - cursorY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: cx, y: cy, price, time: candle.time };
      }
    }
  }

  if (!best) return null;
  if (strength === "weak" && bestDist > WEAK_THRESHOLD_PX) return null;
  return best;
}

function durationLabel(aTime: number, bTime: number): string {
  const diff = Math.abs(bTime - aTime);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

interface Props {
  symbol: string;
  timeframe: Timeframe;
}

const TV_COLORS = {
  bg: "#131722",
  panel: "#1e222d",
  border: "#2a2e39",
  text: "#d1d4dc",
  textMuted: "#787b86",
  green: "#26a69a",
  red: "#ef5350",
  blue: "#2962ff",
  yellow: "#ffb74d",
  purple: "#ab47bc",
  grid: "#1e222d",
};

const PRICE_LINE_COLORS = [
  "#2962ff",
  "#26a69a",
  "#ef5350",
  "#ffb74d",
  "#ab47bc",
  "#00e5ff",
  "#00e676",
  "#ffea00",
  "#ff7043",
  "#ec407a",
  "#7e57c2",
  "#78909c",
  "#ffffff",
];

const PRICE_LINE_WIDTHS = [1, 2, 3, 4] as const;

interface HoverInfo {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  time: number;
  pct: number;
}

interface LastValues {
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  volume?: number;
  tunelDomenecC9?: number;
  controlTotalWPR?: number;
  controlTotalADX?: number;
  almaOsc?: number;
}

interface PaneOffset {
  top: number;
  height: number;
}

export function PriceChart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi30Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi70Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const priceLinesMapRef = useRef<Map<string, IPriceLine>>(new Map());

  // Refs de indicadores nuevos
  const tunelDomenecC9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelDomenecEma8Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelDomenecWilder8Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelFillGreenRef = useRef<FillBand | null>(null);
  const tunelFillRedRef = useRef<FillBand | null>(null);
  // Cintas del Túnel de Domènec (3 túneles × 2 EMAs cada uno + relleno)
  const tunelCinta1LRef = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelCinta1HRef = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelCinta1FillRef = useRef<FillBand | null>(null);
  const tunelCinta2LRef = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelCinta2HRef = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelCinta2FillRef = useRef<FillBand | null>(null);
  const tunelCinta3LRef = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelCinta3HRef = useRef<ISeriesApi<"Line"> | null>(null);
  const tunelCinta3FillRef = useRef<FillBand | null>(null);
  const almaOscRef = useRef<ISeriesApi<"Line"> | null>(null);

  const indicators = useChartStore((s) => s.indicators);
  const hidden = useChartStore((s) => s.hidden);
  const config = useChartStore((s) => s.config);
  const tool = useChartStore((s) => s.tool);
  const magnetStrength = useChartStore((s) => s.magnetStrength);
  const setMagnetStrength = useChartStore((s) => s.setMagnetStrength);
  const priceLines = useChartStore((s) => s.priceLines);
  const addPriceLine = useChartStore((s) => s.addPriceLine);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const toggleHidden = useChartStore((s) => s.toggleHidden);
  const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);

  // Determine which pane each indicator lives in (based on current layout)
  let nextPaneIdx = 1;
  const rsiPaneIdx = indicators.rsi ? nextPaneIdx++ : -1;
  const macdPaneIdx = indicators.macd ? nextPaneIdx++ : -1;
  const almaPaneIdx = indicators.multiAvisos ? nextPaneIdx++ : -1;

  // Refs to avoid recreating subscribeClick on every tool change
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const magnetStrengthRef = useRef(magnetStrength);
  magnetStrengthRef.current = magnetStrength;
  const addPriceLineRef = useRef(addPriceLine);
  addPriceLineRef.current = addPriceLine;
  const updatePriceLine = useChartStore((s) => s.updatePriceLine);
  const updatePriceLineRef = useRef(updatePriceLine);
  updatePriceLineRef.current = updatePriceLine;
  const removePriceLine = useChartStore((s) => s.removePriceLine);
  const removePriceLineRef = useRef(removePriceLine);
  removePriceLineRef.current = removePriceLine;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const configRef = useRef(config);
  configRef.current = config;
  const priceLinesRef = useRef(priceLines);
  priceLinesRef.current = priceLines;
  const priceDragRef = useRef<{ id: string; moved: boolean; currentPrice?: number } | null>(null);
  const [editingLine, setEditingLine] = useState<{
    id: string;
    price: number;
    color: string;
    lineWidth: number;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editColor, setEditColor] = useState(TV_COLORS.blue);
  const [editWidth, setEditWidth] = useState(1);
  const prevSymbolForEditorRef = useRef(symbol);
  if (prevSymbolForEditorRef.current !== symbol) {
    prevSymbolForEditorRef.current = symbol;
    setEditingLine(null);
  }

  const priceLineAt = (py: number, tolerance: number): string | null => {
    const series = candleSeriesRef.current;
    if (!series) return null;
    const lines = priceLinesRef.current.filter(
      (p) => p.symbol === symbolRef.current,
    );
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const pl of lines) {
      const y = series.priceToCoordinate(pl.price);
      if (y === null) continue;
      const dist = Math.abs(y - py);
      if (dist <= tolerance && dist < bestDist) {
        bestDist = dist;
        bestId = pl.id;
      }
    }
    return bestId;
  };

  const isGrabbableTool = () =>
    toolRef.current === "cursor" || toolRef.current === "hline";

  // Hit test de dibujos sobre el chart. Se amplía al añadir más tipos de dibujo
  // (tendencias, rectángulos, texto, fibonacci, etc.).
  type DrawingHit = { kind: "priceLine"; id: string } | null;
  const hitTestDrawing = (py: number): DrawingHit => {
    const id = priceLineAt(py, 12);
    return id ? { kind: "priceLine", id } : null;
  };
  const hitTestDrawingRef = useRef(hitTestDrawing);
  hitTestDrawingRef.current = hitTestDrawing;

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [lastPrice, setLastPrice] = useState<{ value: number; pct: number } | null>(null);
  const [lastValues, setLastValues] = useState<LastValues>({});
  const [paneOffsets, setPaneOffsets] = useState<PaneOffset[]>([]);
  // Measure state now lives in the persisted store, keyed by symbol
  const measure = useChartStore((s) => s.measureBySymbol[symbol] ?? INITIAL_MEASURE);
  const setMeasureForSymbol = useChartStore((s) => s.setMeasureForSymbol);
  const clearMeasureForSymbol = useChartStore((s) => s.clearMeasureForSymbol);
  const updateMeasure = (updater: MeasureState | ((prev: MeasureState) => MeasureState)) => {
    const prev = measureRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    setMeasureForSymbol(symbol, next);
  };
  const updateMeasureRef = useRef(updateMeasure);
  updateMeasureRef.current = updateMeasure;
  const [renderTick, setRenderTick] = useState(0);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  // Magnet snap state (pixel coords + price for the dot indicator)
  const [snapDot, setSnapDot] = useState<SnapPoint | null>(null);
  const snapDotRef = useRef<SnapPoint | null>(null);

  // Reset snap when leaving the magnet tool (render-time prev-value pattern)
  const [prevTool, setPrevTool] = useState(tool);
  if (prevTool !== tool) {
    setPrevTool(tool);
    if (prevTool === "magnet") {
      setSnapDot(null);
      snapDotRef.current = null;
    }
  }

  // Helper — compute pane top offsets from chart layout
  function recomputePaneOffsets() {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    let top = 0;
    const offsets: PaneOffset[] = panes.map((p) => {
      const h = p.getHeight();
      const o = { top, height: h };
      top += h;
      return o;
    });
    setPaneOffsets(offsets);
  }

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: TV_COLORS.bg },
        textColor: TV_COLORS.text,
        fontFamily: "var(--font-sans), Inter, system-ui, sans-serif",
        fontSize: 11,
        panes: { separatorColor: TV_COLORS.border, separatorHoverColor: TV_COLORS.border },
      },
      grid: {
        vertLines: { color: TV_COLORS.grid },
        horzLines: { color: TV_COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
        horzLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
      },
      rightPriceScale: {
        borderColor: TV_COLORS.border,
        textColor: TV_COLORS.textMuted,
      },
      timeScale: {
        borderColor: TV_COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      autoSize: true,
    });

    // PANE 0 — Candles + EMAs
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: TV_COLORS.green,
      downColor: TV_COLORS.red,
      borderUpColor: TV_COLORS.green,
      borderDownColor: TV_COLORS.red,
      wickUpColor: TV_COLORS.green,
      wickDownColor: TV_COLORS.red,
      priceLineColor: TV_COLORS.textMuted,
      priceLineStyle: 2,
    });
    markersRef.current = createSeriesMarkers(candleSeriesRef.current);

    ema20Ref.current = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.ema20,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema50Ref.current = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.ema50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema200Ref.current = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.ema200,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;

    // Click handler — add horizontal price line when hline tool is active
    chart.subscribeClick((param) => {
      if (!param.point || !candleSeriesRef.current) return;

      // If magnet is active, use the snapped price instead of raw cursor price
      const snapped = snapDotRef.current;
      const rawPrice = candleSeriesRef.current.coordinateToPrice(param.point.y);
      const price = snapped ? snapped.price : rawPrice;
      if (price === null || !isFinite(price as number)) return;

      if (toolRef.current === "hline") {
        if (priceLineAt(param.point.y, 8)) return;
        addPriceLineRef.current(price as number, symbolRef.current);
        return;
      }

      if (toolRef.current === "measure") {
        const time = snapped ? snapped.time : Number(param.time);
        if (!time) return;
        const current = measureRef.current;
        if (current.phase === "idle") {
          updateMeasureRef.current({
            phase: "placing",
            a: { time, price: price as number },
            b: { time, price: price as number },
          });
        } else if (current.phase === "placing") {
          updateMeasureRef.current({
            phase: "done",
            a: current.a,
            b: { time, price: price as number },
          });
        } else {
          updateMeasureRef.current({
            phase: "placing",
            a: { time, price: price as number },
            b: { time, price: price as number },
          });
        }
      }
    });

    // Crosshair handler
    chart.subscribeCrosshairMove((param) => {
      // ── Magnet: compute snap point whenever cursor is over the chart ──────
      if (param.point && candleSeriesRef.current) {
        const isMagnetTool = toolRef.current === "magnet";
        // Also apply snap to measure tool when magnet-tool was previously active
        // (snap is always computed so it's available for clicks)
        const snap = findSnapPoint(
          candlesRef.current,
          chart,
          candleSeriesRef.current,
          param.point.x,
          param.point.y,
          isMagnetTool ? magnetStrengthRef.current : "weak",
        );
        const effectiveSnap = isMagnetTool ? snap : snap; // always compute
        snapDotRef.current = isMagnetTool ? effectiveSnap : null;
        setSnapDot(isMagnetTool ? effectiveSnap : null);

        // Move crosshair to snap point when magnet is active
        if (isMagnetTool && snap && candleSeriesRef.current) {
          chart.setCrosshairPosition(
            snap.price,
            snap.time as UTCTimestamp,
            candleSeriesRef.current,
          );
        }
      } else {
        snapDotRef.current = null;
        setSnapDot(null);
      }
      // ─────────────────────────────────────────────────────────────────────

      if (
        toolRef.current === "measure" &&
        measureRef.current.phase === "placing" &&
        param.point &&
        param.time &&
        candleSeriesRef.current
      ) {
        const snapped = snapDotRef.current;
        const price = snapped
          ? snapped.price
          : candleSeriesRef.current.coordinateToPrice(param.point.y);
        if (price !== null && isFinite(price as number)) {
          const time = snapped ? snapped.time : Number(param.time);
          updateMeasureRef.current((prev) =>
            prev.phase === "placing" ? { ...prev, b: { time, price: price as number } } : prev,
          );
        }
      }

      if (!param.time || !candleSeriesRef.current) {
        setHover(null);
        return;
      }
      const data = param.seriesData.get(candleSeriesRef.current);
      const vol = volumeSeriesRef.current
        ? param.seriesData.get(volumeSeriesRef.current)
        : null;
      if (data && "open" in data) {
        const o = data.open as number;
        const c = data.close as number;
        setHover({
          o,
          h: data.high as number,
          l: data.low as number,
          c,
          v: vol && "value" in vol ? (vol.value as number) : 0,
          time: Number(param.time),
          pct: o === 0 ? 0 : ((c - o) / o) * 100,
        });
      }
    });

    // Re-render measure overlay on pan / zoom so pixel coords stay in sync
    const tsRangeHandler = () => setRenderTick((t) => t + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(tsRangeHandler);
    const logicalRangeHandler = () => setRenderTick((t) => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);

    // ResizeObserver — recompute pane offsets when chart container resizes
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => recomputePaneOffsets());
    });
    ro.observe(containerRef.current);
    recomputePaneOffsets();

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(tsRangeHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(logicalRangeHandler);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesMapRef.current.clear();
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
      tunelDomenecC9Ref.current = null;
      tunelDomenecEma8Ref.current = null;
      tunelDomenecWilder8Ref.current = null;
      tunelFillGreenRef.current = null;
      tunelFillRedRef.current = null;
      tunelCinta1LRef.current = null;
      tunelCinta1HRef.current = null;
      tunelCinta1FillRef.current = null;
      tunelCinta2LRef.current = null;
      tunelCinta2HRef.current = null;
      tunelCinta2FillRef.current = null;
      tunelCinta3LRef.current = null;
      tunelCinta3HRef.current = null;
      tunelCinta3FillRef.current = null;
      almaOscRef.current = null;
    };
  }, []);

  // Manage volume — overlay at the bottom of the main pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.volume && !volumeSeriesRef.current) {
      const v = chartRef.current.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: TV_COLORS.textMuted,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        0,
      );
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeriesRef.current = v;
      const data = candlesRef.current.map((k) => ({
        time: k.time as UTCTimestamp,
        value: k.volume,
        color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
      }));
      v.setData(data);
    } else if (!indicators.volume && volumeSeriesRef.current && chartRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.volume]);

  // RSI pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.rsi && !rsiRef.current && rsiPaneIdx !== -1) {
      const paneIndex = rsiPaneIdx;
      const r = chartRef.current.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS.rsi,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r30 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r70 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      rsiRef.current = r;
      rsi30Ref.current = r30;
      rsi70Ref.current = r70;
      try {
        chartRef.current.panes()[1]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}
      updateRSI();
    } else if (!indicators.rsi && rsiRef.current && chartRef.current) {
      chartRef.current.removeSeries(rsiRef.current);
      if (rsi30Ref.current) chartRef.current.removeSeries(rsi30Ref.current);
      if (rsi70Ref.current) chartRef.current.removeSeries(rsi70Ref.current);
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.rsi]);

  // MACD pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.macd && !macdRef.current && macdPaneIdx !== -1) {
      const paneIndex = macdPaneIdx;
      const m = chartRef.current.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS.macd,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const s = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.yellow,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const h = chartRef.current.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      macdRef.current = m;
      macdSignalRef.current = s;
      macdHistRef.current = h;
      try {
        chartRef.current.panes()[paneIndex]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}
      updateMACD();
    } else if (!indicators.macd && macdRef.current && chartRef.current) {
      if (macdRef.current) chartRef.current.removeSeries(macdRef.current);
      if (macdSignalRef.current) chartRef.current.removeSeries(macdSignalRef.current);
      if (macdHistRef.current) chartRef.current.removeSeries(macdHistRef.current);
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.macd, indicators.rsi, macdPaneIdx]);

  // Túnel de Domènec pane 0 indicators
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.tunelDomenec && !tunelDomenecC9Ref.current) {
      const c9 = chartRef.current.addSeries(LineSeries, {
        color: INDICATOR_COLORS.tunelDomenec,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);

      const ema8 = chartRef.current.addSeries(LineSeries, {
        color: "#00e676",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);

      const wilder8 = chartRef.current.addSeries(LineSeries, {
        color: "#d500f9",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);

      // Fill Zona de Corrección — banda entre EMA8 y Wilder8, verde/rojo según cruce
      const fillGreen = new FillBand(ema8, wilder8, {
        color: "#00e676",
        opacity: 0.22,
        colorFor: (a, b) => (a > b ? "#00e676" : "#ff1744"),
      });
      ema8.attachPrimitive(fillGreen);
      tunelFillGreenRef.current = fillGreen;
      tunelFillRedRef.current = null;

      // Cintas institucionales del Túnel de Domènec (3 túneles)
      const cinta1L = chartRef.current.addSeries(LineSeries, {
        color: "#2962ff",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);
      const cinta1H = chartRef.current.addSeries(LineSeries, {
        color: "#2962ff",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);
      const cinta1Fill = new FillBand(cinta1L, cinta1H, {
        color: "#2962ff",
        opacity: 0.25,
      });
      cinta1L.attachPrimitive(cinta1Fill);

      const cinta2L = chartRef.current.addSeries(LineSeries, {
        color: "#faca51",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);
      const cinta2H = chartRef.current.addSeries(LineSeries, {
        color: "#faca51",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);
      const cinta2Fill = new FillBand(cinta2L, cinta2H, {
        color: "#faca51",
        opacity: 0.25,
      });
      cinta2L.attachPrimitive(cinta2Fill);

      const cinta3L = chartRef.current.addSeries(LineSeries, {
        color: "#ff1493",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);
      const cinta3H = chartRef.current.addSeries(LineSeries, {
        color: "#ff1493",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, 0);
      const cinta3Fill = new FillBand(cinta3L, cinta3H, {
        color: "#ff1493",
        opacity: 0.25,
      });
      cinta3L.attachPrimitive(cinta3Fill);

      tunelDomenecC9Ref.current = c9;
      tunelDomenecEma8Ref.current = ema8;
      tunelDomenecWilder8Ref.current = wilder8;
      tunelFillGreenRef.current = fillGreen;
      tunelFillRedRef.current = null;
      tunelCinta1LRef.current = cinta1L;
      tunelCinta1HRef.current = cinta1H;
      tunelCinta1FillRef.current = cinta1Fill;
      tunelCinta2LRef.current = cinta2L;
      tunelCinta2HRef.current = cinta2H;
      tunelCinta2FillRef.current = cinta2Fill;
      tunelCinta3LRef.current = cinta3L;
      tunelCinta3HRef.current = cinta3H;
      tunelCinta3FillRef.current = cinta3Fill;

      updateTunelDomenec();
    } else if (!indicators.tunelDomenec && tunelDomenecC9Ref.current && chartRef.current) {
      chartRef.current.removeSeries(tunelDomenecC9Ref.current);
      if (tunelDomenecEma8Ref.current) chartRef.current.removeSeries(tunelDomenecEma8Ref.current);
      if (tunelDomenecWilder8Ref.current) chartRef.current.removeSeries(tunelDomenecWilder8Ref.current);
      if (tunelCinta1LRef.current) chartRef.current.removeSeries(tunelCinta1LRef.current);
      if (tunelCinta1HRef.current) chartRef.current.removeSeries(tunelCinta1HRef.current);
      if (tunelCinta2LRef.current) chartRef.current.removeSeries(tunelCinta2LRef.current);
      if (tunelCinta2HRef.current) chartRef.current.removeSeries(tunelCinta2HRef.current);
      if (tunelCinta3LRef.current) chartRef.current.removeSeries(tunelCinta3LRef.current);
      if (tunelCinta3HRef.current) chartRef.current.removeSeries(tunelCinta3HRef.current);

      tunelDomenecC9Ref.current = null;
      tunelDomenecEma8Ref.current = null;
      tunelDomenecWilder8Ref.current = null;
      tunelFillGreenRef.current = null;
      tunelFillRedRef.current = null;
      tunelCinta1LRef.current = null;
      tunelCinta1HRef.current = null;
      tunelCinta1FillRef.current = null;
      tunelCinta2LRef.current = null;
      tunelCinta2HRef.current = null;
      tunelCinta2FillRef.current = null;
      tunelCinta3LRef.current = null;
      tunelCinta3HRef.current = null;
      tunelCinta3FillRef.current = null;
    }
  }, [indicators.tunelDomenec]);

  // MultiAvisos / ALMA pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.multiAvisos && !almaOscRef.current && almaPaneIdx !== -1) {
      const paneIndex = almaPaneIdx;
      const alma = chartRef.current.addSeries(LineSeries, {
        color: INDICATOR_COLORS.multiAvisos,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      }, paneIndex);

      almaOscRef.current = alma;

      try {
        chartRef.current.panes()[paneIndex]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}

      updateMultiavisos();
    } else if (!indicators.multiAvisos && almaOscRef.current && chartRef.current) {
      chartRef.current.removeSeries(almaOscRef.current);
      almaOscRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.multiAvisos, indicators.rsi, indicators.macd, almaPaneIdx]);

  // Visibility — eye toggle (hidden state) + enabled state combined
  useEffect(() => {
    const v = (key: IndicatorKey) => indicators[key] && !hidden[key];
    ema20Ref.current?.applyOptions({ visible: v("ema20") });
    ema50Ref.current?.applyOptions({ visible: v("ema50") });
    ema200Ref.current?.applyOptions({ visible: v("ema200") });
    if (rsiRef.current) rsiRef.current.applyOptions({ visible: v("rsi") });
    if (rsi30Ref.current) rsi30Ref.current.applyOptions({ visible: v("rsi") });
    if (rsi70Ref.current) rsi70Ref.current.applyOptions({ visible: v("rsi") });
    if (macdRef.current) macdRef.current.applyOptions({ visible: v("macd") });
    if (macdSignalRef.current) macdSignalRef.current.applyOptions({ visible: v("macd") });
    if (macdHistRef.current) macdHistRef.current.applyOptions({ visible: v("macd") });
    if (volumeSeriesRef.current) volumeSeriesRef.current.applyOptions({ visible: v("volume") });

    // Visibilidad de los nuevos indicadores
    tunelDomenecC9Ref.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelDomenecEma8Ref.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelDomenecWilder8Ref.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelCinta1LRef.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelCinta1HRef.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelCinta2LRef.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelCinta2HRef.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelCinta3LRef.current?.applyOptions({ visible: v("tunelDomenec") });
    tunelCinta3HRef.current?.applyOptions({ visible: v("tunelDomenec") });
    if (almaOscRef.current) almaOscRef.current.applyOptions({ visible: v("multiAvisos") });

    // Limpiar o actualizar marcadores
    if (markersRef.current) {
      if (v("multiAvisos")) {
        updateMultiavisos();
      } else {
        markersRef.current.setMarkers([]);
      }
    }
    // Repintar velas por Control Total
    updateCandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, hidden]);

  // Recompute indicators when config changes (periods)
  useEffect(() => {
    updateEMAs();
  }, [config.ema20, config.ema50, config.ema200]);

  useEffect(() => {
    updateRSI();
  }, [config.rsi]);

  useEffect(() => {
    updateMACD();
  }, [config.macdFast, config.macdSlow, config.macdSignal]);

  useEffect(() => {
    updateTunelDomenec();
  }, [config.tunelPeriod1, config.tunelPeriod2]);

  useEffect(() => {
    updateControlTotal();
  }, [config.controlDocPeriod]);

  useEffect(() => {
    updateMultiavisos();
  }, [config.multiAvisosPeriod]);

  // Sync price lines from store to the candle series
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const map = priceLinesMapRef.current;
    const linesForThisSymbol = priceLines.filter((p) => p.symbol === symbol);
    const activeIds = new Set(linesForThisSymbol.map((p) => p.id));

    for (const [id, apiLine] of map.entries()) {
      if (!activeIds.has(id)) {
        try {
          series.removePriceLine(apiLine);
        } catch {}
        map.delete(id);
      }
    }
    for (const pl of linesForThisSymbol) {
      const existing = map.get(pl.id);
      if (existing) {
        const color = pl.color ?? TV_COLORS.blue;
        const lineWidth = (pl.lineWidth ?? 1) as LineWidth;
        if (
          existing.options().price !== pl.price ||
          existing.options().color !== color ||
          existing.options().lineWidth !== lineWidth
        ) {
          existing.applyOptions({ price: pl.price, color, lineWidth });
        }
      } else {
        const apiLine = series.createPriceLine({
          price: pl.price,
          color: pl.color ?? TV_COLORS.blue,
          lineWidth: (pl.lineWidth ?? 1) as LineWidth,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "",
        });
        map.set(pl.id, apiLine);
      }
    }
  }, [priceLines, symbol]);

  // Interacción con líneas horizontales: arrastrar para mover, doble clic para editar valor
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (e.target instanceof HTMLElement && e.target.closest("button")) return;
      const box = containerRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const py = e.clientY - rect.top;

      // Goma de borrar: elimina el dibujo bajo el cursor
      if (toolRef.current === "eraser") {
        const hit = hitTestDrawingRef.current(py);
        if (hit && hit.kind === "priceLine") {
          removePriceLineRef.current(hit.id);
        }
        return;
      }

      if (!isGrabbableTool()) return;
      const id = priceLineAt(py, 10);
      if (!id) return;
      priceDragRef.current = { id, moved: false };
      chartRef.current?.applyOptions({ handleScroll: { pressedMouseMove: false } });
    };

    const onMouseMove = (e: MouseEvent) => {
      const drag = priceDragRef.current;
      if (!drag || !containerRef.current) return;
      const series = candleSeriesRef.current;
      const rect = containerRef.current.getBoundingClientRect();
      const price = series?.coordinateToPrice(e.clientY - rect.top);
      if (price === null || price === undefined) return;
      const line = priceLinesMapRef.current.get(drag.id);
      if (!line) return;
      line.applyOptions({ price: price as number });
      drag.moved = true;
      drag.currentPrice = price as number;
    };

    const onMouseUp = () => {
      const drag = priceDragRef.current;
      if (drag && drag.moved && drag.currentPrice !== undefined) {
        updatePriceLineRef.current(drag.id, { price: drag.currentPrice });
      }
      priceDragRef.current = null;
      chartRef.current?.applyOptions({ handleScroll: { pressedMouseMove: true } });
    };

    const onDblClick = (e: MouseEvent) => {
      if (!isGrabbableTool() || !containerRef.current) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("button, input, [role='dialog']")
      )
        return;
      const rect = containerRef.current.getBoundingClientRect();
      const id = priceLineAt(e.clientY - rect.top, 14);
      if (!id) return;
      const pl = priceLinesRef.current.find((p) => p.id === id);
      if (pl) {
        setEditValue(String(pl.price));
        setEditColor(pl.color ?? TV_COLORS.blue);
        setEditWidth(pl.lineWidth ?? 1);
        setEditingLine({
          id: pl.id,
          price: pl.price,
          color: pl.color ?? TV_COLORS.blue,
          lineWidth: pl.lineWidth ?? 1,
        });
      }
    };

    el.addEventListener("mousedown", onMouseDown, { capture: true });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("dblclick", onDblClick, { capture: true });
    return () => {
      el.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("dblclick", onDblClick, { capture: true });
      priceDragRef.current = null;
      chartRef.current?.applyOptions({ handleScroll: { pressedMouseMove: true } });
    };
  }, []);

  // Cursor style when drawing tools are active
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor =
        tool === "hline" || tool === "measure" || tool === "magnet" || tool === "eraser"
          ? "crosshair"
          : "";
    }
  }, [tool]);

  // Keyboard shortcut: M = toggle magnet tool
  const setTool = useChartStore((s) => s.setTool);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "m" || e.key === "M") {
        setTool(tool === "magnet" ? "cursor" : "magnet");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, setTool]);

  function updateEMAs() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;
    let last20: number | undefined;
    let last50: number | undefined;
    let last200: number | undefined;

    if (ema20Ref.current) {
      const data = ema(c, cfg.ema20);
      ema20Ref.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      last20 = data.at(-1)?.value;
    }
    if (ema50Ref.current) {
      const data = ema(c, cfg.ema50);
      ema50Ref.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      last50 = data.at(-1)?.value;
    }
    if (ema200Ref.current) {
      const data = ema(c, cfg.ema200);
      ema200Ref.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      last200 = data.at(-1)?.value;
    }
    const lastVol = c.at(-1)?.volume;
    setLastValues((prev) => ({
      ...prev,
      ema20: last20,
      ema50: last50,
      ema200: last200,
      volume: lastVol,
    }));
  }

  function updateRSI() {
    const c = candlesRef.current;
    if (c.length === 0 || !rsiRef.current) return;
    const cfg = configRef.current;
    const data = rsi(c, cfg.rsi).map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
    }));
    rsiRef.current.setData(data);
    if (rsi30Ref.current && data.length > 0)
      rsi30Ref.current.setData([
        { time: data[0].time, value: 30 },
        { time: data[data.length - 1].time, value: 30 },
      ]);
    if (rsi70Ref.current && data.length > 0)
      rsi70Ref.current.setData([
        { time: data[0].time, value: 70 },
        { time: data[data.length - 1].time, value: 70 },
      ]);
    setLastValues((prev) => ({ ...prev, rsi: data.at(-1)?.value }));
  }

  function updateMACD() {
    const c = candlesRef.current;
    if (c.length === 0 || !macdRef.current) return;
    const cfg = configRef.current;
    const m = macd(c, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
    macdRef.current.setData(
      m.map((p) => ({ time: p.time as UTCTimestamp, value: p.macd })),
    );
    macdSignalRef.current?.setData(
      m.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal })),
    );
    macdHistRef.current?.setData(
      m.map((p) => ({
        time: p.time as UTCTimestamp,
        value: p.histogram,
        color: p.histogram >= 0 ? `${TV_COLORS.green}80` : `${TV_COLORS.red}80`,
      })),
    );
    const last = m.at(-1);
    setLastValues((prev) => ({
      ...prev,
      macd: last?.macd,
      macdSignal: last?.signal,
      macdHist: last?.histogram,
    }));
  }

  function updateCandles() {
    const c = candlesRef.current;
    if (c.length === 0 || !candleSeriesRef.current) return;
    const cfg = configRef.current;
    const storeState = useChartStore.getState();

    const colorsMap = new Map<number, string>();
    if (storeState.indicators.controlTotalDoc && !storeState.hidden.controlTotalDoc) {
      const data = calculateControlTotal(c, cfg.controlDocPeriod);
      for (const d of data) {
        colorsMap.set(d.time, d.color);
      }
    }

    candleSeriesRef.current.setData(
      c.map((k) => {
        const customColor = colorsMap.get(k.time);
        return {
          time: k.time as UTCTimestamp,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          ...(customColor
            ? {
                color: customColor,
                borderColor: customColor,
                wickColor: customColor,
              }
            : {}),
        };
      }),
    );
  }

  function updateTunelDomenec() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;

    const data = calculateTunelDomenec(c, cfg.tunelPeriod1, 3.14159265, 8, 8);

    // lightweight-charts rejects NaN/Infinity values, so drop non-finite points
    const line = (points: { time: UTCTimestamp; value?: number }[]) =>
      points.filter((p) => Number.isFinite(p.value));

    if (tunelDomenecC9Ref.current) {
      tunelDomenecC9Ref.current.setData(
        line(
          data.map((p) => ({
            time: p.time as UTCTimestamp,
            value: p.c9,
            color: p.c9Color,
          })),
        ),
      );
    }
    if (tunelDomenecEma8Ref.current) {
      tunelDomenecEma8Ref.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.ema8 }))),
      );
    }
    if (tunelDomenecWilder8Ref.current) {
      tunelDomenecWilder8Ref.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.wilder8 }))),
      );
    }

    // Fill Zona de Corrección — lo dibuja el plugin FillBand (verde/rojo según cruce ema8/wilder8).

    // Cintas institucionales del Túnel de Domènec — 3 túneles de EMAs
    if (tunelCinta1LRef.current) {
      tunelCinta1LRef.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.pema123 }))),
      );
    }
    if (tunelCinta1HRef.current) {
      tunelCinta1HRef.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.pema188 }))),
      );
    }

    if (tunelCinta2LRef.current) {
      tunelCinta2LRef.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.pema416 }))),
      );
    }
    if (tunelCinta2HRef.current) {
      tunelCinta2HRef.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.pema618 }))),
      );
    }

    if (tunelCinta3LRef.current) {
      tunelCinta3LRef.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.pema882 }))),
      );
    }
    if (tunelCinta3HRef.current) {
      tunelCinta3HRef.current.setData(
        line(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.pema1223 }))),
      );
    }

    const last = data.at(-1);
    setLastValues((prev) => ({
      ...prev,
      tunelDomenecC9: last?.c9,
    }));
  }

  function updateControlTotal() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;

    updateCandles();

    const data = calculateControlTotal(c, cfg.controlDocPeriod);
    const last = data.at(-1);
    setLastValues((prev) => ({
      ...prev,
      controlTotalWPR: last?.wpr,
      controlTotalADX: last?.adx,
    }));
  }

  function updateMultiavisos() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;

    const data = calculateMultiavisos(c, 15, 25, 4, 0.85, cfg.multiAvisosPeriod);

    if (almaOscRef.current) {
      almaOscRef.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.alma })),
      );
    }

    if (markersRef.current) {
      const v = (key: IndicatorKey) => indicators[key] && !hidden[key];
      if (v("multiAvisos")) {
        const markers = data
          .flatMap((p) => p.markers)
          .map((m) => ({ ...m, time: m.time as UTCTimestamp }));
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        markersRef.current.setMarkers(markers);
      } else {
        markersRef.current.setMarkers([]);
      }
    }

    const last = data.at(-1);
    setLastValues((prev) => ({
      ...prev,
      almaOsc: last?.alma,
    }));
  }

  // Load historical data + subscribe live
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    async function load() {
      try {
        const klines = await fetchKlines(symbol, timeframe, 1300);
        if (cancelled) return;
        candlesRef.current = klines;
        updateCandles();
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(
            klines.map((k) => ({
              time: k.time as UTCTimestamp,
              value: k.volume,
              color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
            })),
          );
        }
        updateEMAs();
        updateRSI();
        updateMACD();
        updateTunelDomenec();
        updateControlTotal();
        updateMultiavisos();
        chartRef.current?.timeScale().fitContent();
        requestAnimationFrame(() => recomputePaneOffsets());

        if (klines.length > 0) {
          const last = klines[klines.length - 1];
          const prev = klines[klines.length - 2] ?? last;
          setLastPrice({
            value: last.close,
            pct: prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100,
          });
        }

        if (getMarket(symbol) === "crypto") {
          const ws = getBinanceWS();
          unsub = ws.subscribeKline({
          symbol,
          interval: timeframe,
          onCandle: (k) => {
            if (!candleSeriesRef.current) return;
            const arr = candlesRef.current;
            const lastCandle = arr[arr.length - 1];
            if (lastCandle && lastCandle.time === k.time) {
              arr[arr.length - 1] = k;
            } else if (!lastCandle || k.time > lastCandle.time) {
              arr.push(k);
              if (arr.length > 2000) arr.shift();
            } else {
              return;
            }

            const storeState = useChartStore.getState();
            let customColor: string | undefined;
            if (storeState.indicators.controlTotalDoc && !storeState.hidden.controlTotalDoc) {
              const data = calculateControlTotal(arr, storeState.config.controlDocPeriod);
              customColor = data.at(-1)?.color;
            }

            candleSeriesRef.current.update({
              time: k.time as UTCTimestamp,
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
              ...(customColor
                ? {
                    color: customColor,
                    borderColor: customColor,
                    wickColor: customColor,
                  }
                : {}),
            });
            if (volumeSeriesRef.current) {
              volumeSeriesRef.current.update({
                time: k.time as UTCTimestamp,
                value: k.volume,
                color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
              });
            }
            updateEMAs();
            updateRSI();
            updateMACD();
            updateTunelDomenec();
            updateControlTotal();
            updateMultiavisos();
            const prev = arr[arr.length - 2] ?? lastCandle;
            setLastPrice({
              value: k.close,
              pct: prev && prev.close !== 0 ? ((k.close - prev.close) / prev.close) * 100 : 0,
            });
          },
        });
        }
      } catch (e) {
        console.error("Failed to load chart data:", e);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [symbol, timeframe]);

  const greenOrRed = (n: number) =>
    n >= 0 ? "text-tv-green" : "text-tv-red";

  // Helpers for pill rendering
  const isShown = (key: IndicatorKey) =>
    indicators[key] && (key === "volume" || true); // always renderable if enabled
  void isShown;



  let measureRender: React.ReactNode = null;
  if (
    measure.a &&
    measure.b &&
    chartRef.current &&
    candleSeriesRef.current
  ) {
    const ts = chartRef.current.timeScale();
    const aX = ts.timeToCoordinate(measure.a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(measure.b.time as UTCTimestamp);
    const aY = candleSeriesRef.current.priceToCoordinate(measure.a.price);
    const bY = candleSeriesRef.current.priceToCoordinate(measure.b.price);

    if (aX !== null && bX !== null && aY !== null && bY !== null) {
      const priceDiff = measure.b.price - measure.a.price;
      const pctChange =
        measure.a.price === 0 ? 0 : (priceDiff / measure.a.price) * 100;
      const isUp = priceDiff >= 0;
      const start = Math.min(measure.a.time, measure.b.time);
      const end = Math.max(measure.a.time, measure.b.time);
      const inRange = candlesRef.current.filter(
        (c) => c.time >= start && c.time <= end,
      );
      const bars = inRange.length;
      const volume = inRange.reduce((s, c) => s + c.volume, 0);
      const dur = durationLabel(measure.a.time, measure.b.time);

      measureRender = (
        <MeasureOverlay
          aX={aX}
          aY={aY}
          bX={bX}
          bY={bY}
          priceDiff={priceDiff}
          pctChange={pctChange}
          bars={bars}
          volume={volume}
          durationText={dur}
          isUp={isUp}
          isPreview={measure.phase === "placing"}
          onDelete={measure.phase === "done" ? () => clearMeasureForSymbol(symbol) : undefined}
        />
      );
    }
  }
  void renderTick;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {measureRender}

      {/* ── Magnet snap dot ── */}
      {snapDot && (
        <div
          className="pointer-events-none absolute z-30"
          style={{
            left: snapDot.x - 5,
            top: snapDot.y - 5,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#ffb74d",
            border: "2px solid #fff",
            boxShadow: "0 0 6px 2px rgba(255,183,77,0.55)",
          }}
        />
      )}

      {/* ── Magnet toolbar button (bottom-left overlay) ── */}
      <div
        className="absolute bottom-10 left-3 z-20 flex flex-col gap-1"
        style={{ userSelect: "none" }}
      >
        <div className="flex flex-col gap-1 rounded-md overflow-hidden" style={{ background: "#1e222d", border: "1px solid #2a2e39" }}>
          {/* Magnet toggle */}
          <button
            id="toolbar-magnet-btn"
            title={`Magnet — Snap to OHLC (M)\nModo: ${magnetStrength === "weak" ? "Débil" : "Fuerte"}`}
            onClick={() => setTool(tool === "magnet" ? "cursor" : "magnet")}
            className="flex items-center justify-center"
            style={{
              width: 32,
              height: 32,
              background: tool === "magnet" ? "rgba(255,183,77,0.18)" : "transparent",
              border: "none",
              cursor: "pointer",
              color: tool === "magnet" ? "#ffb74d" : "#787b86",
              transition: "color 0.15s, background 0.15s",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 15A6 6 0 0 0 18 15" />
              <line x1="6" y1="15" x2="6" y2="20" />
              <line x1="18" y1="15" x2="18" y2="20" />
              <line x1="2" y1="8" x2="6" y2="8" />
              <line x1="18" y1="8" x2="22" y2="8" />
              <path d="M6 8 A6 6 0 0 1 18 8" />
            </svg>
          </button>
          {/* Weak / Strong toggle (only visible when magnet is active) */}
          {tool === "magnet" && (
            <button
              id="toolbar-magnet-strength-btn"
              title={magnetStrength === "weak" ? "Magnet Débil — click para Fuerte" : "Magnet Fuerte — click para Débil"}
              onClick={() => setMagnetStrength(magnetStrength === "weak" ? "strong" : "weak")}
              className="flex items-center justify-center"
              style={{
                width: 32,
                height: 20,
                background: "transparent",
                border: "none",
                borderTop: "1px solid #2a2e39",
                cursor: "pointer",
                color: "#ffb74d",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.03em",
              }}
            >
              {magnetStrength === "weak" ? "W" : "S"}
            </button>
          )}
        </div>
      </div>

      {/* Top-left of main pane: symbol info + OHLC + Volume pill + EMA pills */}
      <div
        style={{ top: (paneOffsets[0]?.top ?? 0) + 12, left: 12 }}
        className="pointer-events-none absolute z-10 flex flex-col gap-1 text-xs tabular-nums"
      >
        {/* Row 1: symbol info + OHLC stats inline on hover (fixed height, never wraps) */}
        <div className="flex h-5 flex-nowrap items-center gap-x-3 overflow-hidden whitespace-nowrap">
          <div className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
            <span className="text-tv-text">{symbol}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="uppercase text-tv-text-muted">{timeframe}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="text-tv-text-muted">Binance</span>
          </div>
          {hover && (
            <div className="flex items-center gap-x-3 text-[11px]">
              <span className="text-tv-text-muted">
                O <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.o)}</span>
              </span>
              <span className="text-tv-text-muted">
                H <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.h)}</span>
              </span>
              <span className="text-tv-text-muted">
                L <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.l)}</span>
              </span>
              <span className="text-tv-text-muted">
                C <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.c)}</span>
              </span>
              <span className={greenOrRed(hover.pct)}>
                {hover.pct >= 0 ? "+" : ""}
                {hover.pct.toFixed(2)}%
              </span>
              <span className="text-tv-text-muted">
                Vol <span className="text-tv-text">{formatVolume(hover.v)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Row 2: big live price (always present — reserves space even while loading) */}
        <div className="flex h-7 items-center gap-2">
          {lastPrice ? (
            <>
              <span className={`text-lg font-semibold tabular-nums ${greenOrRed(lastPrice.pct)}`}>
                {formatPrice(lastPrice.value)}
              </span>
              <span className={`text-xs ${greenOrRed(lastPrice.pct)}`}>
                {lastPrice.pct >= 0 ? "+" : ""}
                {lastPrice.pct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-xs text-tv-text-muted">Cargando…</span>
          )}
        </div>

        {/* Indicator pills for the main pane (fixed position below price) */}
        <div className="mt-1 flex flex-col items-start gap-1">
          {indicators.ema20 && (
            <IndicatorPill
              name={`EMA ${config.ema20}`}
              value={lastValues.ema20 !== undefined ? formatPrice(lastValues.ema20) : undefined}
              color={INDICATOR_COLORS.ema20}
              hidden={hidden.ema20}
              onToggleHide={() => toggleHidden("ema20")}
              onSettings={() => setSettingsTarget("ema20")}
              onRemove={() => removeIndicator("ema20")}
            />
          )}
          {indicators.ema50 && (
            <IndicatorPill
              name={`EMA ${config.ema50}`}
              value={lastValues.ema50 !== undefined ? formatPrice(lastValues.ema50) : undefined}
              color={INDICATOR_COLORS.ema50}
              hidden={hidden.ema50}
              onToggleHide={() => toggleHidden("ema50")}
              onSettings={() => setSettingsTarget("ema50")}
              onRemove={() => removeIndicator("ema50")}
            />
          )}
          {indicators.ema200 && (
            <IndicatorPill
              name={`EMA ${config.ema200}`}
              value={lastValues.ema200 !== undefined ? formatPrice(lastValues.ema200) : undefined}
              color={INDICATOR_COLORS.ema200}
              hidden={hidden.ema200}
              onToggleHide={() => toggleHidden("ema200")}
              onSettings={() => setSettingsTarget("ema200")}
              onRemove={() => removeIndicator("ema200")}
            />
          )}
          {indicators.volume && (
            <IndicatorPill
              name="Vol"
              value={lastValues.volume !== undefined ? formatVolume(lastValues.volume) : undefined}
              color={INDICATOR_COLORS.volume}
              hidden={hidden.volume}
              onToggleHide={() => toggleHidden("volume")}
              onSettings={() => setSettingsTarget("volume")}
              onRemove={() => removeIndicator("volume")}
            />
          )}
          {indicators.tunelDomenec && (
            <IndicatorPill
              name="Túnel Domènec"
              value={lastValues.tunelDomenecC9 !== undefined ? formatPrice(lastValues.tunelDomenecC9) : undefined}
              color={INDICATOR_COLORS.tunelDomenec}
              hidden={hidden.tunelDomenec}
              onToggleHide={() => toggleHidden("tunelDomenec")}
              onSettings={() => setSettingsTarget("tunelDomenec")}
              onRemove={() => removeIndicator("tunelDomenec")}
            />
          )}
          {indicators.controlTotalDoc && (
            <IndicatorPill
              name="Control Total Doc"
              value={
                lastValues.controlTotalWPR !== undefined && lastValues.controlTotalADX !== undefined
                  ? `W%R: ${lastValues.controlTotalWPR.toFixed(1)} / ADX: ${lastValues.controlTotalADX.toFixed(1)}`
                  : undefined
              }
              color={INDICATOR_COLORS.controlTotalDoc}
              hidden={hidden.controlTotalDoc}
              onToggleHide={() => toggleHidden("controlTotalDoc")}
              onSettings={() => setSettingsTarget("controlTotalDoc")}
              onRemove={() => removeIndicator("controlTotalDoc")}
            />
          )}
        </div>
      </div>

      {/* RSI pane label */}
      {indicators.rsi && paneOffsets[rsiPaneIdx] && (
        <div
          style={{ top: paneOffsets[rsiPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10"
        >
          <IndicatorPill
            name={`RSI ${config.rsi}`}
            value={lastValues.rsi !== undefined ? lastValues.rsi.toFixed(2) : undefined}
            color={INDICATOR_COLORS.rsi}
            hidden={hidden.rsi}
            onToggleHide={() => toggleHidden("rsi")}
            onSettings={() => setSettingsTarget("rsi")}
            onRemove={() => removeIndicator("rsi")}
          />
        </div>
      )}

      {/* MACD pane label */}
      {indicators.macd && paneOffsets[macdPaneIdx] && (
        <div
          style={{ top: paneOffsets[macdPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10"
        >
          <IndicatorPill
            name={`MACD ${config.macdFast}, ${config.macdSlow}, ${config.macdSignal}`}
            value={
              lastValues.macd !== undefined
                ? `${lastValues.macd.toFixed(2)} / ${(lastValues.macdSignal ?? 0).toFixed(2)}`
                : undefined
            }
            color={INDICATOR_COLORS.macd}
            hidden={hidden.macd}
            onToggleHide={() => toggleHidden("macd")}
            onSettings={() => setSettingsTarget("macd")}
            onRemove={() => removeIndicator("macd")}
          />
        </div>
      )}

      {/* ALMA pane label */}
      {indicators.multiAvisos && paneOffsets[almaPaneIdx] && (
        <div
          style={{ top: paneOffsets[almaPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10"
        >
          <IndicatorPill
            name={`ALMA Osc`}
            value={lastValues.almaOsc !== undefined ? lastValues.almaOsc.toFixed(2) : undefined}
            color={INDICATOR_COLORS.multiAvisos}
            hidden={hidden.multiAvisos}
            onToggleHide={() => toggleHidden("multiAvisos")}
            onSettings={() => setSettingsTarget("multiAvisos")}
            onRemove={() => removeIndicator("multiAvisos")}
          />
        </div>
      )}

      {/* ── Editor de propiedades de línea horizontal ── */}
      <Dialog
        open={editingLine !== null}
        onOpenChange={(open) => {
          if (!open) setEditingLine(null);
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Propiedades de la línea</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              type="number"
              step="any"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseFloat(editValue);
                  if (isFinite(v) && editingLine) {
                    updatePriceLine(editingLine.id, {
                      price: v,
                      color: editColor,
                      lineWidth: editWidth,
                    });
                    setEditingLine(null);
                  }
                }
                if (e.key === "Escape") setEditingLine(null);
              }}
              autoFocus
            />

            {/* Color */}
            <div>
              <div className="mb-1 text-[11px] text-[#787b86]">Color</div>
              <div className="flex flex-wrap gap-1.5">
                {PRICE_LINE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setEditColor(c)}
                    title={c}
                    className="h-5 w-5 rounded-full"
                    style={{
                      background: c,
                      outline:
                        editColor === c
                          ? `2px solid #fff`
                          : "1px solid rgba(255,255,255,0.2)",
                      outlineOffset: 1,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Grosor */}
            <div>
              <div className="mb-1 text-[11px] text-[#787b86]">Grosor</div>
              <div className="flex gap-1.5">
                {PRICE_LINE_WIDTHS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setEditWidth(w)}
                    title={`${w}px`}
                    className="flex h-6 w-6 items-center justify-center rounded"
                    style={{
                      background: editWidth === w ? "#2a2e39" : "transparent",
                      border: "1px solid #2a2e39",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: 16,
                        height: Math.min(w, 3),
                        background: editColor,
                        borderRadius: 1,
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingLine(null)}
                className="rounded-md px-3 py-1.5 text-xs"
                style={{ background: "#2a2e39", color: "#d1d4dc" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const v = parseFloat(editValue);
                  if (isFinite(v) && editingLine) {
                    updatePriceLine(editingLine.id, {
                      price: v,
                      color: editColor,
                      lineWidth: editWidth,
                    });
                    setEditingLine(null);
                  }
                }}
                className="rounded-md px-3 py-1.5 text-xs"
                style={{ background: "#2962ff", color: "#fff" }}
              >
                Guardar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
