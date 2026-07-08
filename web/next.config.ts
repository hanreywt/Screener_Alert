import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // this project has its own lockfile; pin the workspace root to avoid
  // Next inferring a parent directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
