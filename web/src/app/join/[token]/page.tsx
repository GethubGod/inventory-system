import type { Metadata } from "next";
import JoinLanding from "@/components/join/JoinLanding";

export const metadata: Metadata = {
  title: "Join Babytuna",
  description: "You've been invited to the Babytuna team app",
};

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  return <JoinLanding token={safeDecode(token)} />;
}
