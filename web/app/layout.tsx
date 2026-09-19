import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Qrib - Bayar QRIS pakai USDC",
  description: "Pindai kode QRIS, kunci kurs, lunasi dalam rupiah.",
};

// Shape rule: buttons are full-pill, cards are 16px. One accent: emerald.
const link = "rounded-full px-4 py-2 text-sm font-medium transition-colors active:scale-[0.98]";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${sans.className} ${mono.variable}`}>
      <body className="bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-4">
            <Link href="/" className="mr-4 text-lg font-bold tracking-tight">
              Qrib
            </Link>
            <Link href="/scan" className={`${link} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
              Pindai QR
            </Link>
            <Link href="/history" className={`${link} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
              Lihat riwayat
            </Link>
            <Link href="/wallet" className={`${link} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
              Dompet
            </Link>
          </nav>
        </header>
        {children}
        <footer className="border-t border-zinc-200 dark:border-zinc-800">
          <p className="mx-auto max-w-7xl px-4 py-6 text-sm text-zinc-600 dark:text-zinc-400">
            Qrib. Testnet: dana tidak bernilai.
          </p>
        </footer>
      </body>
    </html>
  );
}
