import DashboardView from "@/components/dashboard-view";
import { getDashboardAnalytics } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let data;
  try {
    data = await getDashboardAnalytics();
  } catch {
    data = undefined;
  }
  return <DashboardView data={data} />;
}
