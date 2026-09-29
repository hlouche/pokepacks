import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
      path: false,
      os: false,
      crypto: false,
    };
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      buffer: "buffer",
    };
    return config;
  },
};

export default nextConfig;
