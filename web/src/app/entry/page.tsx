import type { Metadata } from "next";
import { EntryForm } from "@/components/entry/EntryForm";

export const metadata: Metadata = {
  title: "Tips — Babytuna",
};

export default function EntryPage() {
  return <EntryForm />;
}
