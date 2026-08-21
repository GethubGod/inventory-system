import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Use | Babytuna Systems",
  description: "Terms governing use of Babytuna Systems.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        These Terms govern Babytuna Systems, including its mobile app, web
        pages, and related services (the “Service”). Babytuna Systems is
        operated by the developer identified on its App Store listing
        (“Babytuna,” “we,” “us,” or “our”). By using the Service, you agree to
        these Terms. If an organization gave you access, you also agree to its
        rules. A separate written agreement with an organization controls if it
        conflicts with these Terms.
      </p>

      <LegalSection title="1. A workplace service">
        <p>
          The Service helps authorized restaurant teams manage inventory,
          ordering, fulfillment, reminders, team access, and related
          operational records. It is not intended for personal consumer use.
          You must be authorized by the organization whose workspace you use.
        </p>
        <p>
          Initial access is normally provided online by a manager. After
          opening the invite in the app, you may create a PIN or password. You
          may not use another person’s invite or credentials.
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts and security">
        <p>
          Provide accurate information and keep your PIN, password, invite
          link, and device secure. Tell your manager promptly if you suspect
          unauthorized access. You are responsible for activity through your
          account unless caused by our failure to use reasonable security
          measures.
        </p>
        <p>
          Managers may create, configure, suspend, reset, or remove accounts
          and control access by location and module. Your organization is
          responsible for deciding who should have access.
        </p>
      </LegalSection>

      <LegalSection title="3. No purchase or subscription required">
        <p>
          The Service does not currently require an in-app payment,
          subscription, or purchase. We do not collect payment-card or
          bank-account information to provide it. If paid services are offered
          later, the price and terms will be disclosed before any charge.
        </p>
      </LegalSection>

      <LegalSection title="4. Permission and acceptable use">
        <p>
          We grant you a limited, revocable, non-exclusive, non-transferable
          right to use the Service for authorized workplace duties. Babytuna
          and its licensors retain the Service, software, design,
          documentation, and branding.
        </p>
        <p>
          You may not sell, lease, sublicense, reverse engineer, disrupt,
          overload, probe, or bypass the Service or its security controls,
          except where law expressly allows it. Do not use the Service to break
          the law, harm another person, introduce malicious code, scrape data
          without permission, impersonate someone, or access records you are
          not authorized to use.
        </p>
      </LegalSection>

      <LegalSection title="5. Workplace data">
        <p>
          You and your organization retain any rights you have in submitted
          information. You permit us to host, process, transmit, back up, and
          display it only as reasonably needed to operate, secure, support, and
          improve the Service and meet legal obligations.
        </p>
        <p>
          Your organization controls its business records. Information you
          enter may be visible to managers and authorized teammates. Do not
          submit information you are not authorized to share.
        </p>
      </LegalSection>

      <LegalSection title="6. Operational decisions">
        <p>
          Inventory counts, suggestions, reminders, supplier messages, voice
          interpretations, and other outputs can be incomplete or incorrect.
          Review important quantities, recipients, dates, and order details.
          Your organization remains responsible for purchasing, food safety,
          accounting, payroll, tax, staffing, and other business decisions.
        </p>
      </LegalSection>

      <LegalSection title="7. Third-party services">
        <p>
          The Service may rely on third parties for hosting, authentication,
          notifications, app distribution, links, and optional voice or image
          processing. Their services may have their own terms. We are not
          responsible for services we do not control, but we select and manage
          providers with the aim of reliable and secure operation.
        </p>
      </LegalSection>

      <LegalSection title="8. Updates and availability">
        <p>
          We may add, change, or remove features; release app or over-the-air
          updates; perform maintenance; or discontinue all or part of the
          Service. We will try to avoid unreasonable disruption and give notice
          of material changes when practical. Availability can be affected by
          internet, device, operating-system, and third-party outages.
        </p>
      </LegalSection>

      <LegalSection title="9. Suspension and termination">
        <p>
          You may stop using the Service at any time. Managers may suspend or
          remove workplace access. We may limit access to protect the Service
          or others, respond to law, address misuse, or discontinue the
          Service. Account deletion may not remove business records that an
          organization must retain or that have been reassigned, aggregated, or
          de-identified.
        </p>
      </LegalSection>

      <LegalSection title="10. Disclaimers">
        <p>
          We aim to provide a useful and reliable Service. To the extent
          permitted by law, it is provided “as is” and “as available.” We do
          not promise uninterrupted or error-free operation or that every
          suggestion or record will be accurate. Nothing here excludes rights
          that cannot legally be excluded.
        </p>
      </LegalSection>

      <LegalSection title="11. Limits on liability">
        <p>
          To the extent permitted by law, Babytuna and its providers will not
          be liable for indirect, incidental, special, consequential,
          exemplary, or punitive damages, or lost profits, revenue, data,
          goodwill, or opportunities arising from the Service.
        </p>
        <p>
          For claims the law allows us to limit, total liability will not
          exceed the greater of amounts paid specifically for the Service in
          the prior 12 months or US $100. This does not limit liability for
          fraud, willful misconduct, gross negligence, personal injury, or
          liability that cannot legally be limited.
        </p>
      </LegalSection>

      <LegalSection title="12. Responsibility for misuse">
        <p>
          To the extent permitted by law, you and your organization are
          responsible for third-party claims and direct losses caused by
          unlawful use, deliberate violation of these Terms, or material you
          had no right to provide. This does not cover losses caused by our own
          misconduct.
        </p>
      </LegalSection>

      <LegalSection title="13. Resolving concerns and applicable law">
        <p>
          Contact us first so we can try to resolve concerns informally. These
          Terms are governed by the laws that apply where the Service operator
          is established, without regard to conflict-of-law rules. Disputes may
          be brought in courts with lawful jurisdiction. Non-waivable local
          rights remain intact.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes and contact">
        <p>
          We may update these Terms as the Service changes. We will post the
          revised date and give additional notice when a change is material.
          Continued use after they take effect means acceptance.
        </p>
        <p>
          For account questions, contact your manager. For legal or Service
          questions, use the developer contact method available through the
          Babytuna Systems App Store listing or website.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
