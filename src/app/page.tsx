import { redirect } from "next/navigation";
import HomeDashboard from "@/components/home-dashboard";
import { isSetupComplete } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const configured = await isSetupComplete().catch(() => false);
  if (!configured) redirect("/setup");
  return <HomeDashboard />;
}
