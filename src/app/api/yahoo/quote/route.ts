import { fetchYahooQuotes } from "@/lib/yahoo/rest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return Response.json({ error: "bad params" }, { status: 400 });
  }

  try {
    const data = await fetchYahooQuotes(symbols);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}