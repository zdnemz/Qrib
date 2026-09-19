import Link from "next/link";
import MobileNav from "../../components/MobileNav";

const link = "rounded-full px-4 py-2 text-sm font-medium transition-colors active:scale-[0.98]";

const NAV = [
  { href: "/fitur", label: "Fitur" },
  { href: "/biaya", label: "Biaya" },
  { href: "/keamanan", label: "Keamanan" },
  { href: "/faq", label: "FAQ" },
];

const FOOT = [
  {
    title: "Produk",
    links: [
      { href: "/fitur", label: "Fitur" },
      { href: "/biaya", label: "Biaya" },
      { href: "/scan", label: "Pindai QR" },
      { href: "/wallet", label: "Dompet" },
    ],
  },
  {
    title: "Kepercayaan",
    links: [
      { href: "/keamanan", label: "Keamanan" },
      { href: "/faq", label: "FAQ" },
      { href: "/history", label: "Lihat riwayat" },
    ],
  },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <nav className="relative mx-auto flex h-16 max-w-7xl items-center gap-1 px-4">
          <Link href="/" className="mr-4 text-lg font-bold tracking-tight">
            Qrib
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {NAV.map((l) => (
              <Link key={l.href} href={l.href} className={`${link} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
                {l.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/scan"
              className="hidden rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 active:scale-[0.98] md:inline-block dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300"
            >
              Pindai QR
            </Link>
            <MobileNav />
          </div>
        </nav>
      </header>
      {children}
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-3">
          <div>
            <p className="text-lg font-bold tracking-tight">Qrib</p>
            <p className="mt-2 max-w-[40ch] text-sm text-zinc-600 dark:text-zinc-400">
              Bayar QRIS pakai USDC. Pindai, kunci kurs, lunasi dalam rupiah.
            </p>
          </div>
          {FOOT.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-sm font-semibold">{col.title}</p>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="mx-auto max-w-7xl px-4 pb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Qrib. Testnet: dana tidak bernilai.
        </p>
      </footer>
    </>
  );
}
