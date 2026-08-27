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
    return Promise.resolve([
      {
        // Apple fetches this to enable iCloud Keychain autofill for the app
        // (webcredentials associated domain). It must be served as JSON.
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ]);
  },
};

export default nextConfig;
