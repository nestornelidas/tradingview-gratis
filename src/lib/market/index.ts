import {
  fetchKlines as fetchBinanceKlines,
  fetchTickers24h as fetchBinanceTickers,
} from "@/lib/binance/rest";
import type { Candle, Ticker24h, Timeframe } from "@/lib/binance/types";

export type Market = "crypto" | "stocks";

const QUOTE_SUFFIXES = [
  "USDT",
  "FDUSD",
  "USDC",
  "BUSD",
  "TUSD",
  "DAI",
  "EUR",
  "BTC",
  "ETH",
];

export function getMarket(symbol: string): Market {
  const s = symbol.trim().toUpperCase();
  return QUOTE_SUFFIXES.some((q) => s.endsWith(q)) ? "crypto" : "stocks";
}

export async function fetchKlines(
  symbol: string,
  interval: Timeframe,
  limit = 1000,
): Promise<Candle[]> {
  if (getMarket(symbol) === "crypto") {
    return fetchBinanceKlines(symbol, interval, limit);
  }
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  const res = await fetch(`/api/yahoo/chart?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`yahoo klines ${res.status}`);
  return res.json() as Promise<Candle[]>;
}

async function fetchYahooQuotes(symbols: string[]): Promise<Ticker24h[]> {
  const res = await fetch(
    `/api/yahoo/quote?symbols=${encodeURIComponent(symbols.join(","))}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`yahoo quote ${res.status}`);
  return res.json() as Promise<Ticker24h[]>;
}

export async function fetchTickers24h(symbols: string[]): Promise<Ticker24h[]> {
  const cryptoSyms: string[] = [];
  const stockSyms: string[] = [];
  symbols.forEach((s) => {
    if (getMarket(s) === "crypto") cryptoSyms.push(s);
    else stockSyms.push(s);
  });

  const [cryptoResult, stockResult] = await Promise.all([
    cryptoSyms.length > 0
      ? fetchBinanceTickers(cryptoSyms)
      : Promise.resolve<Ticker24h[]>([]),
    stockSyms.length > 0
      ? fetchYahooQuotes(stockSyms)
      : Promise.resolve<Ticker24h[]>([]),
  ]);

  return [...cryptoResult, ...stockResult];
}

export interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: "EQUITY" | "ETF" | "INDEX";
}

export async function searchStocks(q: string): Promise<StockSearchResult[]> {
  const res = await fetch(
    `/api/yahoo/search?q=${encodeURIComponent(q.trim())}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`yahoo search ${res.status}`);
  return res.json() as Promise<StockSearchResult[]>;
}