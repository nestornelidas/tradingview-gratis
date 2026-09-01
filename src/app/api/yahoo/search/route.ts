import { searchYahooSymbols } from "@/lib/yahoo/rest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";

  if (!q.trim()) {
    return Response.json([]);
  }

  try {
    const data = await searchYahooSymbols(q.trim());
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}