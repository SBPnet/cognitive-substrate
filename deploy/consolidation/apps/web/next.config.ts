import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
};

export default config;
