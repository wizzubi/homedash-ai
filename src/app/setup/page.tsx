import type { Metadata } from "next";
import SetupWizard from "@/components/setup-wizard";
import { isSetupComplete } from "@/lib/dashboard-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HomeDash AI · Konfiguracja początkowa",
  description: "Kilkustopniowy kreator pierwszego uruchomienia domowego kiosku.",
  robots: { index: false, follow: false },
};

/**
 * Po ukończeniu kreatora kierujemy wprost do dashboardu — dzięki temu ekran
 * konfiguracji nie pojawia się nawet na chwilę po pierwszej konfiguracji.
 */
export default async function SetupPage() {
  const configured = await isSetupComplete().catch(() => false);
  if (configured) redirect("/");
  return <SetupWizard />;
}
