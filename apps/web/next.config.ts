import "@Closer/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  allowedDevOrigins: ['192.168.1.178','192.168.1.10']
};

export default nextConfig;
