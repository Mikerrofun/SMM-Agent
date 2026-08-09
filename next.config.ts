import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone mode - только сервер, без статики
  output: 'standalone',
  
  // Отключаем React Strict Mode (может влиять на prerender)
  reactStrictMode: false,
};

export default nextConfig;
