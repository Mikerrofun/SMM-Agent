import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone mode - только сервер, без статики
  output: 'standalone',
  
  // Отключаем React Strict Mode
  reactStrictMode: false,
  
  // Настройки статической генерации - отключаем retry
  experimental: {
    staticGenerationRetryCount: 0,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 0,
  },
};

export default nextConfig;
