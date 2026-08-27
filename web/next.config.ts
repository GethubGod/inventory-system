import type { NextConfig } from "next";

/** Manager dashboard host. The tips app owns "/" on its own host as the staff
 *  scan screen, so the dashboard gets a host rather than a path. */
const DASHBOARD_HOST = "dashboard.smelterpos.com";

const nextConfig: NextConfig = {
  rewrites() {
    return Promise.resolve({
      // beforeFiles, not a bare array: "/" is a prerendered page, and an
      // afterFiles rewrite never fires because the static file wins first.
      beforeFiles: [
        {
          // Rewrite, not redirect: the address bar stays on the dashboard host
          // instead of bouncing visitors to /manager. Every other path is
          // untouched, so /manager and /manager/qr keep working everywhere.
          source: "/",
          has: [{ type: "host", value: DASHBOARD_HOST }],
          destination: "/manager",
        },
      ],
      afterFiles: [],
      fallback: [],
    });
  },
  headers() {
    // Entry sessions and manager auth live in browser storage, and QR tokens
    // ride in URLs — so lock down what a page can do and where URLs leak.
    // script-src keeps 'unsafe-inline' because Next/Turbopack ship inline
    // runtime scripts without nonces; connect-src is the real perimeter
    // (only our Supabase project can be talked to).
    const contentSecurityPolicy = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    return Promise.resolve([
      {
        // Apple fetches this to enable iCloud Keychain autofill for the app
        // (webcredentials associated domain). It must be served as JSON.
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // QR entry tokens ride in the ?t= query param — never let the URL
          // leave this origin via Referer.
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
