import { z } from "zod";
import { runBatchSearch } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ITEMS = 50;

const requestSchema = z.object({
  items: z.array(z.string().trim().min(3).max(2_000)).min(1).max(MAX_ITEMS),
  limit: z.number().int().min(3).max(10).default(5),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const results = await runBatchSearch(input.items, input.limit);
    return Response.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: `Enter 1–${MAX_ITEMS} material specifications, each at least 3 characters` }, { status: 400 });
    const message = error instanceof Error ? error.message : "Search failed";
    return Response.json({ error: message.includes("DATABASE_URL") ? message : "The search could not be completed" }, { status: 500 });
  }
}
