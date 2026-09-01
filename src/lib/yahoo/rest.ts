import type { Candle, Ticker24h, Timeframe } from "@/lib/binance/types";

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH_BASE = "https://query2.finance.yahoo.com/v1/finance/search";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const HEADERS = { "User-Agent": UA, Accept: "application/json" };

const TF_MIN: Record<Timeframe, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "6h": 360,
  "8h": 480,
  "12h": 720,
  "1d": 1440,
  "3d": 4320,
  "1w": 10080,
  "1M": 43200,
};

function sourceForTarget(tf: Timeframe): { interval: string; range: string } {
  const min = TF_MIN[tf];
  if (min <= 1) return { interval: "1m", range: "5d" };
  if (min === 3) return { interval: "1m", range: "7d" };
  if (min <= 5) return { interval: "5m", range: "1mo" };
  if (min <= 15) return { interval: "15m", range: "1mo" };
  if (min <= 30) return { interval: "30m", range: "1mo" };
  if (min < 1440) return { interval: "60m", range: "2y" };
  if (min === 1440) return { interval: "1d", range: "5y" };
  if (min === 4320) return { interval: "1d", range: "10y" };
  if (min === 10080) return { interval: "1wk", range: "max" };
  return { interval: "1mo", range: "max" };
}

/** Yahoo chart API no soporta todos los timeframes de Binance: para los que,
 * faltan (3m, 2h, 4h, 6h, 8h, 12h, 3d) se pide un intervalo menor y se agrega. */
function aggregateCandles(src: Candle[], targetSec: number): Candle[] {
  if (targetSec <= 1) return src;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let bucket = -1;
  for (const g of src) {
    const b = Math.floor(g.time / targetSec) * targetSec;
    if (cur && b === bucket) {
      cur.high = Math.max(cur.high, g.high);
      cur.low = Math.min(cur.low, g.low);
      cur.close = g.close;
      cur.volume += g.volume;
    } else {
      if (cur) out.push(cur);
      cur = {
        time: b,
        open: g.open,
        high: g.high,
        low: g.low,
        close: g.close,
        volume: g.volume,
        isFinal: true,
      };
      bucket = b;
    }
  }
  if (cur) out.push(cur);
  return out;
}

interface ChartQuote {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
}

interface ChartMeta {
  symbol?: string;
  regularMarketPrice?: number | null;
  previousClose?: number | null;
  chartPreviousClose?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  regularMarketVolume?: number | null;
}

interface ChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: ChartMeta;
      indicators?: { quote?: ChartQuote[] };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

export async function fetchYahooCandles(
  symbol: string,
  interval: string,
  range: string,
): Promise<Candle[]> {
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`;
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`yahoo chart ${res.status}`);
  const data = (await res.json()) as ChartResponse;
  const result = data.chart?.result?.[0];
  if (!result || data.chart?.error) {
    throw new Error(
      `yahoo chart ${data.chart?.error?.description ?? "no data"}`,
    );
  }
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q?.open?.[i];
    const h = q?.high?.[i];
    const l = q?.low?.[i];
    const c = q?.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({
      time: ts[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: q?.volume?.[i] ?? 0,
      isFinal: true,
    });
  }
  return out;
}

export async function fetchYahooKlines(
  symbol: string,
  tf: Timeframe,
  limit = 1000,
): Promise<Candle[]> {
  const min = TF_MIN[tf];
  const { interval, range } = sourceForTarget(tf);
  const raw = await fetchYahooCandles(symbol, interval, range);
  if (raw.length === 0) return raw;
  const candles = aggregateCandles(raw, min * 60);
  return candles.slice(-limit);
}

export async function fetchYahooQuotes(
  symbols: string[],
): Promise<Ticker24h[]> {
  return Promise.all(symbols.map(fetchQuoteForSymbol));
}

async function fetchQuoteForSymbol(symbol: string): Promise<Ticker24h> {
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false`;
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`yahoo quote ${res.status}`);
  const data = (await res.json()) as ChartResponse;
  const result = data.chart?.result?.[0];
  if (!result || data.chart?.error) {
    throw new Error(`yahoo quote ${data.chart?.error?.description ?? "no data"}`);
  }

  const meta = result.meta ?? {};
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  const closes: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q?.close?.[i];
    if (c != null) closes.push(c);
  }
  const lastSeriesClose = closes.length > 0 ? closes[closes.length - 1] : 0;
  const prevSeriesClose =
    closes.length > 1 ? closes[closes.length - 2] : lastSeriesClose;

  const lastPrice =
    typeof meta.regularMarketPrice === "number"
      ? meta.regularMarketPrice
      : lastSeriesClose;
  const prev =
    typeof meta.previousClose === "number"
      ? meta.previousClose
      : typeof meta.chartPreviousClose === "number"
        ? meta.chartPreviousClose
        : prevSeriesClose;

  return {
    symbol: (meta.symbol ?? symbol).toUpperCase(),
    lastPrice,
    priceChange: lastPrice - prev,
    priceChangePercent: prev === 0 ? 0 : ((lastPrice - prev) / prev) * 100,
    highPrice:
      typeof meta.regularMarketDayHigh === "number"
        ? meta.regularMarketDayHigh
        : lastPrice,
    lowPrice:
      typeof meta.regularMarketDayLow === "number"
        ? meta.regularMarketDayLow
        : lastPrice,
    volume:
      typeof meta.regularMarketVolume === "number"
        ? meta.regularMarketVolume
        : 0,
    quoteVolume: 0,
  };
}

export interface YahooSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: "EQUITY" | "ETF" | "INDEX";
}

export async function searchYahooSymbols(
  q: string,
): Promise<YahooSearchResult[]> {
  const url = `${SEARCH_BASE}?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`;
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`yahoo search ${res.status}`);
  const data = (await res.json()) as {
    quotes?: Array<Record<string, unknown>>;
  };
  return (data.quotes ?? [])
    .filter(
      (r) =>
        r.quoteType === "EQUITY" || r.quoteType === "ETF" || r.quoteType === "INDEX",
    )
    .map((r) => ({
      symbol: r.symbol as string,
      name: (r.shortname ?? r.longname ?? r.symbol) as string,
      exchange: r.exchange as string,
      type: r.quoteType as "EQUITY" | "ETF" | "INDEX",
    }));
}