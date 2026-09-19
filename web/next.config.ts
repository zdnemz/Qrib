import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PWA is mobile-web-first per PRD §17; the API lives next door (see
  // NEXT_PUBLIC_API_URL). No image optimization or i18n routing in v1.
  //
  // Next 16 blocks dev-server resources (client JS chunks, HMR) from any
  // origin not listed here. Without this, opening the app through a tunnel or
  // a LAN IP serves the HTML but NO client JavaScript — so client components
  // never hydrate and nothing interactive works (the camera silently never
  // requests permission). Dev-only; it has no effect on production builds.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "localhost",
    "127.0.0.1",
    ...(process.env.DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
};

export default nextConfig;
