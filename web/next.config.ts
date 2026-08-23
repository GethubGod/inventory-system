import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
