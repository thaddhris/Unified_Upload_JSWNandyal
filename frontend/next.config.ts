import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin Turbopack's project root to this app so it doesn't wander up to
  // ~/package-lock.json and try to watch the entire home directory (which
  // makes the first compile hang forever).
  turbopack: {
    root: path.join(__dirname),
  },
  allowedDevOrigins: [
    "unifiedupload.iocompute.ai",
    "*.iocompute.ai",
  ],
};

export default nextConfig;
