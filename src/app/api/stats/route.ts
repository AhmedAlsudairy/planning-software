import { getMaterialStats } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await getMaterialStats());
  } catch {
    return Response.json({ configured: true, materials: 0, active: 0, uploads: 0, lastUpload: null, error: "Database unavailable" }, { status: 503 });
  }
}
