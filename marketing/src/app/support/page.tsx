import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Support | smelter",
  description: "How to get help with smelter.",
};

export default function SupportPage() {
  return (
    <LegalPage title="Support">
      <p>
        smelter is a workplace service used by authorized restaurant teams.
        The fastest path to help depends on what you need.
      </p>

      <LegalSection title="Account and access">
        <p>
          Invites, PINs, passwords, locations, and module access are managed by
          your organization. If you can&rsquo;t sign in, lost your invite link,
          or need your access changed, contact your manager — they can reset
          credentials and re-issue invites from the app.
        </p>
      </LegalSection>

      <LegalSection title="App problems">
        <p>
          If something isn&rsquo;t working, first make sure you&rsquo;re on the
          latest version of the app from the App Store, then close and reopen
          it. Most sync issues resolve once the device is back on a stable
          internet connection.
        </p>
      </LegalSection>

      <LegalSection title="Contact the developer">
        <p>
          For technical issues that persist, privacy requests, or anything a
          manager can&rsquo;t resolve, reach the developer through the contact
          method on the smelter App Store listing. Include your organization,
          the screen you were on, and what you expected to happen — that makes
          fixes much faster.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
