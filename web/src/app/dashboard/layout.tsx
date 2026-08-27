import type { Metadata } from "next";
import DashboardGate from "@/components/dashboard/DashboardGate";

export const metadata: Metadata = {
  title: "smelter dashboard",
  description: "Manager dashboard for smelter",
};

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <DashboardGate>{children}</DashboardGate>;
}
