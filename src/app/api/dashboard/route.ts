import { getDashboardAnalytics } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getDashboardAnalytics());
  } catch {
    return Response.json({ error: "Dashboard analytics are unavailable" }, { status: 503 });
  }
}
