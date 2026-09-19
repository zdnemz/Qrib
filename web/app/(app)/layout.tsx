import Link from "next/link";

// Shape rule: buttons are full-pill, cards are 16px. One accent: emerald.
const link = "rounded-full px-4 py-2 text-sm font-medium transition-colors active:scale-[0.98]";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
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
    </>
  );
}
