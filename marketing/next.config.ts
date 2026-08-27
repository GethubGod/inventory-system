import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  redirects() {
    return Promise.resolve([
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
