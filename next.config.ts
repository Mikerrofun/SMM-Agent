import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  
  experimental: {
    // @ts-ignore
    skipTrailingSlashRedirect: true,
  },
};

export default nextConfig;
