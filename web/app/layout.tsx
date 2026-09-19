import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qrib — Bayar QRIS pakai USDC",
  description: "Scan → confirm → paid. USDC to QRIS wallet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
