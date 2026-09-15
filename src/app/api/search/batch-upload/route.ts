import { runBatchSearch } from "@/lib/search";
import { parseSearchItemsFile } from "@/lib/spreadsheet";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const limit = Number(formData.get("limit")) || 5;
    if (!(file instanceof File)) return Response.json({ error: "Select an Excel or CSV file" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "The file exceeds the 5 MB limit" }, { status: 413 });
    const items = await parseSearchItemsFile(file.name, Buffer.from(await file.arrayBuffer()));
    if (!items.length) return Response.json({ error: "No usable specification rows were found (add a Specification/Description column)" }, { status: 400 });
    const results = await runBatchSearch(items, Math.min(10, Math.max(3, limit)));
    return Response.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk search failed";
    return Response.json({ error: message.includes("DATABASE_URL") || message.includes("supported") || message.includes("worksheet") ? message : "The bulk search could not be completed" }, { status: 500 });
  }
}
