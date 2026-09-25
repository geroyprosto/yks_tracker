import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright runs a second dev server; keep its cache and build output apart
  // from the signed-in local app on port 3000.
  distDir: process.env.YKSIM_E2E === "1" ? ".next-e2e" : ".next",
  devIndicators: false,
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;


