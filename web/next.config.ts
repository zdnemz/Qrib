import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PWA is mobile-web-first per PRD §17; the API lives next door (see
  // NEXT_PUBLIC_API_URL). No image optimization or i18n routing in v1.
};

export default nextConfig;
