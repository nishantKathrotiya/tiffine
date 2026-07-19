import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bottom-left overlaps the mobile nav's first tab; top-right overlaps the
  // sign-out button. Bottom-right is clear of both. Dev-only — the indicator
  // is not present in production builds.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
