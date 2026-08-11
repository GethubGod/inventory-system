import type { Metadata } from "next";
import DashboardGate from "@/components/dashboard/DashboardGate";

export const metadata: Metadata = {
  title: "Babytuna Dashboard",
  description: "Manager dashboard for Babytuna Systems",
};

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <DashboardGate>{children}</DashboardGate>;
}
