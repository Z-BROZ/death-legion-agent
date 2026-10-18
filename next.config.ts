import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render / HF / local → standalone server.
  // Netlify builds with its own Next.js runtime → plain output there.
  ...(process.env.NETLIFY ? {} : { output: "standalone" as const }),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
