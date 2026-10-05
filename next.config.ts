import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next's dev badge is pinned bottom-left, exactly on top of the account row
  // at the foot of the sidebar. It never ships to production, so all it does
  // here is hide a control while the UI is being reviewed.
  devIndicators: false,
  eslint: {
    dirs: ["app", "components", "lib", "data", "stores", "types"],
  },
  // The previous generation's destinations, kept reachable for old links.
  async redirects() {
    return [
      { source: "/workspace/:path*", destination: "/transitions", permanent: false },
      { source: "/scenario-lab", destination: "/simulator", permanent: false },
      { source: "/decisions", destination: "/actions", permanent: false },
    ];
  },
};

export default nextConfig;
