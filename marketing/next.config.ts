import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  redirects() {
    return Promise.resolve([
      {
        // The apex is canonical, so www normalizes to it before anything else.
        source: "/:path*",
        has: [{ type: "host", value: "www.smelterpos.com" }],
        destination: "https://smelterpos.com/:path*",
        permanent: true,
      },
      {
        // The mobile app's About screen links to /contact; support covers it.
        source: "/contact",
        destination: "/support",
        permanent: true,
      },
    ]);
  },
};

export default nextConfig;
