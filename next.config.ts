import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright runs a second dev server; keep its cache and build output apart
  // from the signed-in local app on port 3000.
  distDir: process.env.YKSIM_E2E === "1" ? ".next-e2e" : process.env.CLASSROOM_DEV === "1" ? ".next-classroom" : ".next",
  devIndicators: false,
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;


