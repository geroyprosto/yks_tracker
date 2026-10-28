import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright runs a second dev server; keep its cache and build output apart
  // from the signed-in local app on port 3000.
  distDir: process.env.NODE_ENV === 'development' && process.env.NOVA_PREVIEW === '1' ? '.next-nova-preview' : process.env.YKSIM_E2E === "1" ? ".next-e2e" : process.env.CLASSROOM_DEV === "1" ? ".next-classroom" : ".next",
  devIndicators: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  headers: async () => [{
    source: '/:path*',
    headers: [
      {key:'Content-Security-Policy',value:"frame-ancestors 'none'"},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'X-Content-Type-Options',value:'nosniff'},
    ],
  }],
};

export default nextConfig;


