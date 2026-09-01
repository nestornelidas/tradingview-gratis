"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Search, ChevronDown, Coins, LineChart } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchExchangeSymbols } from "@/lib/binance/rest";
import { searchStocks, type StockSearchResult } from "@/lib/market";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";
import type { SymbolInfo } from "@/lib/binance/types";

const POPULAR_STOCKS: StockSearchResult[] = [
  { symbol: "AAPL", name: "Apple", exchange: "NMS", type: "EQUITY" },
  { symbol: "MSFT", name: "Microsoft", exchange: "NMS", type: "EQUITY" },
  { symbol: "GOOGL", name: "Alphabet", exchange: "NMS", type: "EQUITY" },
  { symbol: "AMZN", name: "Amazon", exchange: "NMS", type: "EQUITY" },
  { symbol: "NVDA", name: "NVIDIA", exchange: "NMS", type: "EQUITY" },
  { symbol: "TSLA", name: "Tesla", exchange: "NMS", type: "EQUITY" },
  { symbol: "META", name: "Meta Platforms", exchange: "NMS", type: "EQUITY" },
  { symbol: "NFLX", name: "Netflix", exchange: "NMS", type: "EQUITY" },
  { symbol: "AMD", name: "Advanced Micro Devices", exchange: "NMS", type: "EQUITY" },
  { symbol: "INTC", name: "Intel", exchange: "NMS", type: "EQUITY" },
  { symbol: "SPY", name: "S&P 500 ETF", exchange: "PCX", type: "ETF" },
  { symbol: "QQQ", name: "Nasdaq-100 ETF", exchange: "NGM", type: "ETF" },
  { symbol: "^GSPC", name: "S&P 500 Index", exchange: "SNP", type: "INDEX" },
  { symbol: "^IXIC", name: "Nasdaq Composite", exchange: "NMS", type: "INDEX" },
  { symbol: "^DJI", name: "Dow Jones", exchange: "DJI", type: "INDEX" },
];

type Tab = "crypto" | "stocks";

export function SymbolSelector() {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const addToWatchlist = useChartStore((s) => s.addToWatchlist);
  const open = useChartStore((s) => s.symbolDialogOpen);
  const setOpen = useChartStore((s) => s.setSymbolDialogOpen);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("crypto");
  const [allSymbols, setAllSymbols] = useState<SymbolInfo[]>([]);
  const [stockResults, setStockResults] = useState<StockSearchResult[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open && tab === "crypto" && allSymbols.length === 0) {
      fetchExchangeSymbols().then(setAllSymbols).catch(console.error);
    }
  }, [open, tab, allSymbols.length]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (tab !== "stocks") return;
    if (!value.trim()) {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      setStockResults([]);
      setStockLoading(false);
      return;
    }
    setStockLoading(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchStocks(value)
        .then(setStockResults)
        .catch(() => setStockResults([]))
        .finally(() => setStockLoading(false));
    }, 350);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return allSymbols.slice(0, 100);
    return allSymbols
      .filter(
        (s) =>
          s.symbol.includes(q) ||
          s.baseAsset.includes(q) ||
          s.quoteAsset.includes(q),
      )
      .slice(0, 100);
  }, [query, allSymbols]);

  const pick = (s: string) => {
    setSymbol(s);
    addToWatchlist(s);
    setOpen(false);
    setQuery("");
  };

  const q = query.trim();
  const list = tab === "crypto" ? filtered : q ? stockResults : POPULAR_STOCKS;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="group flex items-center gap-2 rounded px-3 py-1.5 text-sm font-semibold hover:bg-tv-panel-hover">
        <Search className="h-3.5 w-3.5 text-tv-text-muted group-hover:text-tv-text" />
        <span className="tabular-nums">{symbol}</span>
        <ChevronDown className="h-3.5 w-3.5 text-tv-text-muted" />
      </DialogTrigger>
      <DialogContent className="max-w-md gap-0 bg-tv-panel p-0">
        <DialogHeader className="border-b border-tv-border px-4 py-3">
          <DialogTitle className="text-sm font-medium">Buscar símbolo</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1 border-b border-tv-border p-3">
          <button
            onClick={() => {
              setTab("crypto");
              setQuery("");
            }}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
              tab === "crypto"
                ? "bg-tv-panel-hover text-tv-text"
                : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
            )}
          >
            <Coins className="h-3.5 w-3.5" />
            Cripto
          </button>
          <button
            onClick={() => {
              setTab("stocks");
              setQuery("");
            }}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
              tab === "stocks"
                ? "bg-tv-panel-hover text-tv-text"
                : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
            )}
          >
            <LineChart className="h-3.5 w-3.5" />
            Acciones
          </button>
        </div>
        <div className="border-b border-tv-border p-3">
          <Input
            autoFocus
            placeholder={tab === "crypto" ? "BTC, ETH, SOL…" : "AAPL, TSLA, SPY…"}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="bg-tv-bg"
          />
        </div>
        <ScrollArea className="h-[400px]">
          <div className="flex flex-col">
            {list.length === 0 && !stockLoading && (
              <div className="p-4 text-center text-xs text-tv-text-muted">
                Sin resultados
              </div>
            )}
            {stockLoading && (
              <div className="p-4 text-center text-xs text-tv-text-muted">
                Buscando…
              </div>
            )}
            {tab === "crypto" &&
              list.map((s) => {
                const info = s as SymbolInfo;
                return (
                  <button
                    key={info.symbol}
                    onClick={() => pick(info.symbol)}
                    className={cn(
                      "flex items-center justify-between border-b border-tv-border px-4 py-2 text-left text-xs hover:bg-tv-panel-hover",
                      info.symbol === symbol && "bg-tv-panel-hover",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-tv-text">{info.baseAsset}</span>
                      <span className="text-tv-text-muted">/ {info.quoteAsset}</span>
                    </div>
                    <span className="text-tv-text-muted">{info.symbol}</span>
                  </button>
                );
              })}
            {tab === "stocks" &&
              list.map((s) => {
                const st = s as StockSearchResult;
                return (
                  <button
                    key={st.symbol}
                    onClick={() => pick(st.symbol)}
                    className={cn(
                      "flex items-center justify-between border-b border-tv-border px-4 py-2 text-left text-xs hover:bg-tv-panel-hover",
                      st.symbol === symbol && "bg-tv-panel-hover",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 font-semibold text-tv-text">{st.symbol}</span>
                      <span className="truncate text-tv-text-muted">{st.name}</span>
                    </div>
                    <span className="text-[10px] text-tv-text-dim">{st.type}</span>
                  </button>
                );
              })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}