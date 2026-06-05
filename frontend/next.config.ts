import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Static export — the iocompute.ai deploy pipeline serves `out/` via nginx
  // and has no Node runtime. Server-only features (API routes, middleware)
  // are NOT available in this mode. The proxy routes that bridged CORS to
  // connector.iosense.io / appserver.iosense.io were removed; the client now
  // calls those upstreams directly. IOsense must allow our deployed origin
  // (currently *.iocompute.ai) on its CORS allow-list or every request will
  // be blocked before it leaves the browser.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },

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
