"use client";

import { useEffect, useState } from "react";
import { useChartStore } from "@/lib/store/chart-store";
import { fetchTicker24h } from "@/lib/binance/rest";
import type { Ticker24h } from "@/lib/binance/types";
import { formatPrice, formatPct, formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BottomPanel() {
  const symbol = useChartStore((s) => s.symbol);
  const [t, setT] = useState<{ symbol: string; tick: Ticker24h } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchTicker24h(symbol)
        .then((x) => {
          if (!cancelled) setT({ symbol, tick: x });
        })
        .catch(console.error);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  const tick = t && t.symbol === symbol ? t.tick : null;
  const upClass = (n: number) => (n >= 0 ? "text-tv-green" : "text-tv-red");

  return (
    <div className="flex h-9 items-center gap-0 border-t border-tv-border bg-tv-panel px-3 text-xs">
      <Stat label="Símbolo" value={symbol} />
      <Stat
        label="24h Cambio"
        value={tick ? formatPct(tick.priceChangePercent) : "—"}
        valueClass={tick ? upClass(tick.priceChangePercent) : ""}
      />
      <Stat
        label="24h Alto"
        value={tick ? formatPrice(tick.highPrice) : "—"}
        valueClass="text-tv-green"
      />
      <Stat
        label="24h Bajo"
        value={tick ? formatPrice(tick.lowPrice) : "—"}
        valueClass="text-tv-red"
      />
      <Stat
        label="24h Vol (base)"
        value={tick ? formatVolume(tick.volume) : "—"}
      />
      <Stat
        label="24h Vol (USDT)"
        value={tick ? formatVolume(tick.quoteVolume) : "—"}
      />
      <div className="ml-auto flex items-center gap-2 text-[10px] text-tv-text-dim">
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-tv-green" />
        <span>Binance · Live</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 border-r border-tv-border px-3">
      <span className="text-tv-text-dim">{label}</span>
      <span className={cn("font-medium tabular-nums", valueClass ?? "text-tv-text")}>
        {value}
      </span>
    </div>
  );
}
