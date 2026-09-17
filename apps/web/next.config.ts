import "@Closer/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.CLOSER_NEXT_DIST_DIR ?? ".next",
  typedRoutes: true,
  reactCompiler: true,
  allowedDevOrigins: ['192.168.1.178','192.168.1.10']
};

export default nextConfig;
