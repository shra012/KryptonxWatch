import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server opened by IP from other machines (GB10 LAN address, Tailscale clients); without this,
  // Next.js blocks cross-origin /_next dev assets such as hot reload.
  // 100.90.95.118: shravan's laptop, 100.97.56.67: shreyas's laptop (Tailscale).
  allowedDevOrigins: ["10.36.35.170", "100.90.95.118", "100.97.56.67", "*.ts.net"],
};

export default nextConfig;
