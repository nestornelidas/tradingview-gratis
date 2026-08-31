import type { Candle } from "@/lib/binance/types";

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MACDPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Simple Moving Average
 */
export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

/**
 * Exponential Moving Average — seeded with SMA of first `period` candles.
 */
export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/**
 * RSI (Wilder) — period typically 14.
 */
export function rsi(candles: Candle[], period = 14): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  let rs = loss === 0 ? 100 : gain / loss;
  out.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) });
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rs = loss === 0 ? 100 : gain / loss;
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

/**
 * MACD — fast EMA, slow EMA, signal EMA of the MACD line.
 * Defaults: 12 / 26 / 9.
 */
export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDPoint[] {
  if (candles.length < slow + signal) return [];
  const emaFast = ema(candles, fast);
  const emaSlow = ema(candles, slow);
  // align: emaSlow starts later
  const slowStartTime = emaSlow[0].time;
  const fastByTime = new Map(emaFast.map((p) => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const p of emaSlow) {
    const f = fastByTime.get(p.time);
    if (f !== undefined) macdLine.push({ time: p.time, value: f - p.value });
  }
  // signal = EMA of MACD line. Build synthetic candles for ema()
  const synth: Candle[] = macdLine.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
    volume: 0,
  }));
  const sig = ema(synth, signal);
  const sigByTime = new Map(sig.map((p) => [p.time, p.value]));
  const out: MACDPoint[] = [];
  for (const p of macdLine) {
    const s = sigByTime.get(p.time);
    if (s === undefined) continue;
    out.push({ time: p.time, macd: p.value, signal: s, histogram: p.value - s });
  }
  void slowStartTime;
  return out;
}

// Raw calculations aligned to input indices to prevent offsets
// These are NaN-safe: leading (and intermittent) NaN values do not poison the
// smoothing state, and `period` valid samples are required before emitting.
export function rmaRaw(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;

  let prev = NaN;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNaN(v)) continue;
    if (count === 0) {
      prev = v;
      count = 1;
    } else if (count < period) {
      prev = (prev * count + v) / (count + 1);
      count++;
    } else {
      prev = (prev * (period - 1) + v) / period;
    }
    if (count === period) out[i] = prev;
  }
  return out;
}

export function emaRaw(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);

  let prev = NaN;
  let count = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNaN(v)) continue;
    if (count < period) {
      sum += v;
      count++;
      if (count === period) {
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function demaRaw(values: number[], period: number): number[] {
  const ema1 = emaRaw(values, period);
  // Reemplazar NaN para la segunda pasada de EMA
  const ema1Clean = ema1.map((v) => (isNaN(v) ? 0 : v));
  const ema2 = emaRaw(ema1Clean, period);
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (!isNaN(ema1[i]) && !isNaN(ema2[i])) {
      out[i] = 2 * ema1[i] - ema2[i];
    }
  }
  return out;
}

export function smaRaw(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function stdevRaw(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;

  const sma = smaRaw(values, period);

  for (let i = period - 1; i < values.length; i++) {
    const avg = sma[i];
    let sumSq = 0;
    for (let k = 0; k < period; k++) {
      const diff = values[i - k] - avg;
      sumSq += diff * diff;
    }
    out[i] = Math.sqrt(sumSq / period);
  }
  return out;
}

export function almaRaw(
  values: number[],
  length: number,
  offset: number,
  sigma: number,
): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < length) return out;

  const m = offset * (length - 1);
  const s = length / sigma;

  const weights = new Array<number>(length);
  let norm = 0;
  for (let k = 0; k < length; k++) {
    const w = Math.exp(-((k - m) * (k - m)) / (2 * s * s));
    weights[k] = w;
    norm += w;
  }

  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    for (let k = 0; k < length; k++) {
      sum += weights[k] * values[i - (length - 1 - k)];
    }
    out[i] = sum / norm;
  }
  return out;
}

export function wprRaw(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period) return out;

  for (let i = period - 1; i < candles.length; i++) {
    let highestHigh = candles[i].high;
    let lowestLow = candles[i].low;
    for (let k = 1; k < period; k++) {
      const c = candles[i - k];
      if (c.high > highestHigh) highestHigh = c.high;
      if (c.low < lowestLow) lowestLow = c.low;
    }
    const diff = highestHigh - lowestLow;
    if (diff === 0) {
      out[i] = -50;
    } else {
      out[i] = ((highestHigh - candles[i].close) / diff) * -100;
    }
  }
  return out;
}

export interface ADXResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function adxRaw(candles: Candle[], period = 14): ADXResult {
  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    const tr1 = c.high - c.low;
    const tr2 = Math.abs(c.high - prev.close);
    const tr3 = Math.abs(c.low - prev.close);
    tr.push(Math.max(tr1, tr2, tr3));

    const upMove = c.high - prev.high;
    const downMove = prev.low - c.low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  const smoothTR = rmaRaw(tr, period);
  const smoothPlusDM = rmaRaw(plusDM, period);
  const smoothMinusDM = rmaRaw(minusDM, period);

  const plusDI = new Array<number>(candles.length).fill(NaN);
  const minusDI = new Array<number>(candles.length).fill(NaN);
  const dx = new Array<number>(candles.length).fill(NaN);

  for (let i = 0; i < candles.length; i++) {
    const str = smoothTR[i];
    const sDMp = smoothPlusDM[i];
    const sDMm = smoothMinusDM[i];

    if (!isNaN(str) && str !== 0) {
      plusDI[i] = (sDMp / str) * 100;
      minusDI[i] = (sDMm / str) * 100;

      const sum = plusDI[i] + minusDI[i];
      const diff = Math.abs(plusDI[i] - minusDI[i]);
      if (sum !== 0) {
        dx[i] = (diff / sum) * 100;
      } else {
        dx[i] = 0;
      }
    }
  }

  const adx = rmaRaw(
    dx.map((v) => (isNaN(v) ? 0 : v)),
    period,
  );
  for (let i = 0; i < period * 2 - 1; i++) {
    if (i < adx.length) adx[i] = NaN;
  }

  return { adx, plusDI, minusDI };
}

// ----------------------------------------------------
// INDICATORS OUTPUT STRUCTURES
// ----------------------------------------------------

export interface TunelDomenecResult {
  time: number;
  c9: number;
  c9Color: string;
  alt: number;
  baix: number;
  ema8: number;
  wilder8: number;
  pema123: number;
  pema188: number;
  pema416: number;
  pema618: number;
  pema882: number;
  pema1223: number;
}

/**
 * Túnel de Domènec — calcula las bandas institucionales (DEMA de RMA de rangos),
 * la Genial Line (promedio de suavizados y SMA34) y las cintas institucionales
 * (3 túneles de EMAs largas con sus rellenos).
 */
export function calculateTunelDomenec(
  candles: Candle[],
  velasBanda = 20,
  desviacio = 3.14159265358979,
  ema8Period = 8,
  wilder8Period = 8,
): TunelDomenecResult[] {
  const out: TunelDomenecResult[] = [];
  if (candles.length === 0) return out;

  const closes = candles.map((c) => c.close);
  const ranges = candles.map((c) => c.high - c.low);

  const smoothPrice = rmaRaw(closes, velasBanda);
  const smoothRange = rmaRaw(ranges, velasBanda);

  const alt1: number[] = [];
  const baix1: number[] = [];
  const mitjana: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const sp = smoothPrice[i];
    const sr = smoothRange[i];
    if (isNaN(sp) || isNaN(sr)) {
      alt1.push(NaN);
      baix1.push(NaN);
      mitjana.push(NaN);
    } else {
      alt1.push(sp + sr * desviacio);
      baix1.push(sp - sr * desviacio);
      mitjana.push(sp);
    }
  }

  const alt = demaRaw(alt1, velasBanda);
  const baix = demaRaw(baix1, velasBanda);
  const sma34 = smaRaw(closes, 34);

  const ema8 = emaRaw(closes, ema8Period);
  const wilder8 = rmaRaw(closes, wilder8Period);

  const pema123 = emaRaw(closes, 123);
  const pema188 = emaRaw(closes, 188);
  const pema416 = emaRaw(closes, 416);
  const pema618 = emaRaw(closes, 618);
  const pema882 = emaRaw(closes, 882);
  const pema1223 = emaRaw(closes, 1223);

  for (let i = 0; i < candles.length; i++) {
    const m = mitjana[i];
    const s34 = sma34[i];
    const a = alt[i];
    const b = baix[i];
    const e8 = ema8[i];
    const w8 = wilder8[i];

    if (
      isNaN(m) ||
      isNaN(s34) ||
      isNaN(a) ||
      isNaN(b) ||
      isNaN(e8) ||
      isNaN(w8)
    ) {
      continue;
    }

    const c9Val = (m + s34) / 2;
    let c9Color = "#2962ff";
    if (i > 0) {
      const prevC9Val = (mitjana[i - 1] + sma34[i - 1]) / 2;
      if (!isNaN(prevC9Val)) {
        c9Color = c9Val > prevC9Val ? "#2962ff" : "#ff1744";
      }
    }

    out.push({
      time: candles[i].time,
      c9: c9Val,
      c9Color,
      alt: a,
      baix: b,
      ema8: e8,
      wilder8: w8,
      pema123: pema123[i],
      pema188: pema188[i],
      pema416: pema416[i],
      pema618: pema618[i],
      pema882: pema882[i],
      pema1223: pema1223[i],
    });
  }

  return out;
}

export interface ControlTotalResult {
  time: number;
  color: string;
  trend: "bullish" | "bearish" | "neutral";
  wpr: number;
  adx: number;
}

/**
 * Sistema Control Total — diagnostica y colorea las velas
 * basándose en la convergencia del momentum (Williams %R) y fuerza (ADX).
 */
export function calculateControlTotal(
  candles: Candle[],
  period = 14,
): ControlTotalResult[] {
  const out: ControlTotalResult[] = [];
  if (candles.length === 0) return out;

  const wpr = wprRaw(candles, period);
  const { adx, plusDI, minusDI } = adxRaw(candles, period);

  for (let i = 0; i < candles.length; i++) {
    const w = wpr[i];
    const a = adx[i];
    const pDI = plusDI[i];
    const mDI = minusDI[i];

    if (isNaN(w) || isNaN(a) || isNaN(pDI) || isNaN(mDI)) {
      continue;
    }

    let color = "#787b86";
    let trend: "bullish" | "bearish" | "neutral" = "neutral";

    if (a > 22) {
      if (pDI > mDI && w > -30) {
        color = "#00e676"; // Verde
        trend = "bullish";
      } else if (mDI > pDI && w < -70) {
        color = "#ff1744"; // Rojo
        trend = "bearish";
      }
    }

    out.push({
      time: candles[i].time,
      color,
      trend,
      wpr: w,
      adx: a,
    });
  }

  return out;
}

export interface MultiavisosMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}

export interface MultiavisosResult {
  time: number;
  alma: number;
  markers: MultiavisosMarker[];
}

/**
 * Multiavisos — calcula señales (Mi, Ma, ▲, ▼, Exhaustion) y oscilador ALMA.
 */
export function calculateMultiavisos(
  candles: Candle[],
  fa = 15,
  Sl = 25,
  Sig = 4,
  Offs = 0.85,
  permitjdesv = 120,
): MultiavisosResult[] {
  const out: MultiavisosResult[] = [];
  if (candles.length === 0) return out;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const zc = emaRaw(closes, 15);
  const faMA = almaRaw(closes, fa, Offs, Sig);
  const SlMA = almaRaw(closes, Sl, Offs, Sig);

  const highest30 = new Array<number>(candles.length).fill(NaN);
  for (let i = 29; i < candles.length; i++) {
    let max = highs[i];
    for (let k = 1; k < 30; k++) {
      if (highs[i - k] > max) max = highs[i - k];
    }
    highest30[i] = max;
  }

  const cond1: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const h30 = highest30[i];
    if (isNaN(h30) || h30 === 0) {
      cond1.push(NaN);
    } else {
      cond1.push((h30 - closes[i]) / h30);
    }
  }

  const av1 = smaRaw(
    cond1.map((v) => (isNaN(v) ? 0 : v)),
    permitjdesv,
  );
  const stdv1 = stdevRaw(
    cond1.map((v) => (isNaN(v) ? 0 : v)),
    permitjdesv,
  );

  const cond2 = smaRaw(closes, 30);
  const av2 = smaRaw(
    cond2.map((v) => (isNaN(v) ? 0 : v)),
    permitjdesv,
  );
  const stdv2 = stdevRaw(
    cond2.map((v) => (isNaN(v) ? 0 : v)),
    permitjdesv,
  );

  for (let i = 0; i < candles.length; i++) {
    const fma = faMA[i];
    const sma_val = SlMA[i];

    if (isNaN(fma) || isNaN(sma_val)) {
      continue;
    }

    const almaVal = fma - sma_val;
    const markers: MultiavisosMarker[] = [];

    // Ma/Mi de ciclo largo (80 velas)
    if (i >= 80) {
      let isMax = true;
      let isMin = true;
      const currentHigh = highs[i];
      const currentLow = lows[i];
      for (let k = 1; k < 80; k++) {
        if (highs[i - k] > currentHigh) isMax = false;
        if (lows[i - k] < currentLow) isMin = false;
      }
      if (isMax) {
        markers.push({
          time: candles[i].time,
          position: "aboveBar",
          color: "#2962ff",
          shape: "arrowDown",
          text: "Ma",
        });
      }
      if (isMin) {
        markers.push({
          time: candles[i].time,
          position: "belowBar",
          color: "#ff1744",
          shape: "arrowUp",
          text: "Mi",
        });
      }
    }

    // Avisos de corrección
    const z = zc[i];
    if (!isNaN(z) && i >= 3) {
      const c = closes[i];
      const c1 = closes[i - 1];
      const c2 = closes[i - 2];
      const c3 = closes[i - 3];

      if (c > z) {
        if (c1 > c2 && c2 > c3 && c < c1) {
          markers.push({
            time: candles[i].time,
            position: "aboveBar",
            color: "#ff1744",
            shape: "arrowDown",
            text: "▼",
          });
        }
      }
      if (c < z) {
        if (c1 < c2 && c2 < c3 && c > c1) {
          markers.push({
            time: candles[i].time,
            position: "belowBar",
            color: "#00e676",
            shape: "arrowUp",
            text: "▲",
          });
        }
      }
    }

    // Agotamiento
    const c1zon = av1[i] + stdv1[i];
    const c2zon = av2[i] - stdv2[i];
    if (cond1[i] > c1zon && cond2[i] < c2zon) {
      markers.push({
        time: candles[i].time,
        position: "belowBar",
        color: "#ab47bc",
        shape: "circle",
        text: "•",
      });
    }

    out.push({
      time: candles[i].time,
      alma: almaVal,
      markers,
    });
  }

  return out;
}


