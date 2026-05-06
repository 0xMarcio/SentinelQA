import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sentinelqa/ui", "@sentinelqa/dsl"],
  typedRoutes: false,
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"]
    };
    return config;
  }
};

export default nextConfig;
