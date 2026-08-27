import type { Metadata } from "next";
import { EntryForm } from "@/components/entry/EntryForm";

export const metadata: Metadata = {
  title: "tips — smelter",
};

export default function EntryPage() {
  return <EntryForm />;
}
