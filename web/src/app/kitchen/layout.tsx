import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "smelter kitchen",
  description: "Kitchen requests for smelter",
};

export default function KitchenLayout({ children }: LayoutProps<"/kitchen">) {
  return children;
}
