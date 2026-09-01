import { fetchYahooKlines } from "@/lib/yahoo/rest";
import type { Timeframe } from "@/lib/binance/types";

export const dynamic = "force-dynamic";

const INTERVALS: Timeframe[] = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const interval = url.searchParams.get("interval") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? "1000");

  if (!symbol || !(INTERVALS as string[]).includes(interval)) {
    return Response.json({ error: "bad params" }, { status: 400 });
  }

  try {
    const data = await fetchYahooKlines(
      symbol,
      interval as Timeframe,
      Number.isFinite(limit) && limit > 0 ? limit : 1000,
    );
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}