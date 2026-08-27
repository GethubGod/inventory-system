import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | smelter",
  description: "How smelter handles information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="August 26, 2026">
      <p>
        This Policy explains how smelter handles information through its
        mobile app, web pages, and related services (the “Service”). smelter
        is operated by the developer identified on its App Store listing
        (“smelter,” “we,” “us,” or “our”). The Service is for authorized
        restaurant teams, not general consumer use.
      </p>

      <LegalSection title="1. Who controls workplace information">
        <p>
          The organization that invites you generally decides why workplace
          information is collected, who may use it, and how long it is kept.
          smelter processes it to provide the Service. Managers may view and
          manage information in their organization’s workspace.
        </p>
        <p>
          Onboarding normally begins online through a manager-created invite.
          The invite opens the app, where you create a PIN or password. Legacy
          access methods may also use an email address or access code.
        </p>
      </LegalSection>

      <LegalSection title="2. Information we handle">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Account and team information, including name, optional email,
            role, assigned location, enabled modules, account status, invite
            status, and sign-in identifier.
          </li>
          <li>
            Authentication and security information, including hashed PINs or
            passwords, sessions, failed attempts, device details, and security
            logs. We do not store readable PINs or passwords.
          </li>
          <li>
            Workplace records, including inventory, storage areas, orders,
            notes, suppliers, fulfillment, checklists, reminders,
            notifications, tip entries, and timestamps.
          </li>
          <li>
            Content you choose to provide, such as profile images, photos,
            voice input, corrections, messages, and notes.
          </li>
          <li>
            Technical information, such as app version, operating system,
            push token, diagnostics, IP address, browser or device type, and
            basic usage events needed to operate and secure the Service.
          </li>
        </ul>
        <p>
          No payment is required, and we do not collect payment-card or
          bank-account information for the Service.
        </p>
      </LegalSection>

      <LegalSection title="3. Microphone, camera, and photos">
        <p>
          The Service accesses these only when you choose a related feature and
          grant permission. Voice features may send audio or a transcription to
          providers to interpret an inventory count, order, or tip entry.
          Camera and photo features may process an image for your requested
          action. The Service is not designed to record continuously.
        </p>
        <p>
          Avoid including private conversations or unnecessary personal
          information. You can revoke device permissions, although the feature
          may then be unavailable.
        </p>
      </LegalSection>

      <LegalSection title="4. How we use information">
        <ul className="list-disc space-y-2 pl-5">
          <li>Create and secure accounts and complete manager-authorized onboarding.</li>
          <li>Provide the enabled workplace features and synchronize authorized records.</li>
          <li>Deliver notifications and let managers administer team access.</li>
          <li>Process optional voice or image requests.</li>
          <li>Troubleshoot errors, prevent abuse, and maintain reliability.</li>
          <li>Improve the Service using aggregated, de-identified, or protected information.</li>
          <li>Comply with law, enforce terms, and protect people and organizations.</li>
        </ul>
        <p>
          We do not sell personal information, use workplace information for
          third-party targeted advertising, or include third-party ad trackers.
        </p>
      </LegalSection>

      <LegalSection title="5. When information is shared">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Within your organization, according to role, location, and enabled
            modules.
          </li>
          <li>
            With providers for database hosting, authentication, web hosting,
            app distribution, notifications, diagnostics, and optional voice
            or image processing.
          </li>
          <li>
            With a supplier, messaging app, or destination when an authorized
            user chooses to send or share information.
          </li>
          <li>
            When reasonably needed for law, valid legal process, safety,
            security, fraud prevention, or enforcement.
          </li>
          <li>
            In a merger, financing, acquisition, reorganization, or asset sale,
            subject to appropriate confidentiality and notice.
          </li>
        </ul>
        <p>We do not share personal information with data brokers or advertisers.</p>
      </LegalSection>

      <LegalSection title="6. Retention">
        <p>
          We keep information as reasonably needed to provide and secure the
          Service, support operations, resolve disputes, and meet legal duties.
          An organization may retain order, inventory, fulfillment, or tip
          records after a user leaves. Security logs and backups may remain for
          a limited period. When data is no longer needed, we delete,
          de-identify, or securely isolate it; backups may take longer to expire.
        </p>
      </LegalSection>

      <LegalSection title="7. Your choices and rights">
        <p>
          You may review account details in the app and control camera,
          microphone, photo, and notification permissions in device settings.
          Where available, you can request account deletion in the app. Ask
          your manager to correct, export, restrict, or remove workplace
          records.
        </p>
        <p>
          Depending on your location, you may have rights to know, access,
          correct, delete, or receive personal information, or to object to or
          limit processing. You may have appeal or regulator-complaint rights.
          We will not discriminate for a valid request. We may verify identity,
          and some requests must be handled by your organization.
        </p>
      </LegalSection>

      <LegalSection title="8. Account deletion">
        <p>
          Deletion removes the authentication account and personal access where
          supported. It may delete or detach profile, notification, and device
          token information. Records needed for legitimate workplace operations
          may remain, be reassigned, or be de-identified. A consumed invite
          remains consumed to prevent reuse even if its user reference is
          removed.
        </p>
      </LegalSection>

      <LegalSection title="9. Security">
        <p>
          We use reasonable safeguards including access controls, role and
          location restrictions, encrypted connections, hashed credentials,
          rate limits, and restricted server credentials. No method is
          completely secure, so absolute security cannot be guaranteed.
        </p>
      </LegalSection>

      <LegalSection title="10. Children and international processing">
        <p>
          The Service is a workplace tool and is not directed to children under
          13. Organizations should not invite someone who is not legally
          permitted to use it for workplace duties.
        </p>
        <p>
          Information may be processed in the United States and other places
          where providers operate. Where required, appropriate measures are
          used for cross-border transfers.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes and contact">
        <p>
          We may update this Policy as the Service or law changes. We will
          update the effective date and give additional notice for material
          changes.
        </p>
        <p>
          For workplace-data questions or requests, contact your manager first.
          For privacy questions, use the developer contact method available
          through the smelter App Store listing or the support page on this
          site.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
