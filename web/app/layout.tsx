import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Qrib - Bayar QRIS pakai USDC",
  description: "Pindai kode QRIS, kunci kurs, lunasi dalam rupiah.",
};

// Bare shell. Headers and footers live in the route-group layouts so
// marketing and product surfaces keep their own navigation.

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${sans.className} ${mono.variable}`}>
      <body className="bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
