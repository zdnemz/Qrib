import Link from "next/link";
import { card, muted, primary, secondary, tint } from "../lib/ui";

// Landing: trust-first. Three sections, zero eyebrows, one accent (emerald),
// buttons pill + cards 16px. Motion 3: hover and active states only.

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4">
      <section className="grid min-h-[calc(100dvh-8rem)] items-center gap-10 py-12 md:grid-cols-2">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter md:text-6xl">
            Bayar QRIS pakai USDC.
          </h1>
          <p className={`mt-4 max-w-[65ch] text-base leading-relaxed ${muted}`}>
            Pindai kode QRIS, kunci kurs 90 detik, lunasi dalam rupiah.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/scan" className={primary}>
              Pindai QR
            </Link>
            <Link href="/history" className={secondary}>
              Lihat riwayat
            </Link>
          </div>
        </div>
        <div>
          <div className={tint}>
            <p className={`font-mono text-xs ${muted}`}>STRUK</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">Rp27.500</p>
            <p className={`mt-1 text-sm ${muted}`}>Kopi Kenangan</p>
            <p className="mt-4 inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300">
              Lunas
            </p>
          </div>
          <p className={`mt-2 text-sm ${muted}`}>Contoh struk.</p>
        </div>
      </section>

      <section className="py-16">
        <h2 className="text-3xl font-bold tracking-tighter">Cara kerja</h2>
        <p className={`mt-2 max-w-[65ch] ${muted}`}>
          Tiga langkah dari pindai sampai lunas, tanpa aplikasi bank tambahan.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className={`${tint} md:col-span-2`}>
            <h3 className="text-xl font-semibold">Pindai</h3>
            <p className={`mt-1 max-w-[65ch] ${muted}`}>
              Tempel payload QRIS. Nominal dinamis langsung terbaca, nominal statis tinggal isi
              sendiri.
            </p>
          </div>
          <div className={card}>
            <h3 className="text-xl font-semibold">Kunci</h3>
            <p className={`mt-1 ${muted}`}>Minta quote dan kunci kurs 90 detik sebelum bayar.</p>
          </div>
          <div className={`${card} border-emerald-700/30 dark:border-emerald-400/30`}>
            <h3 className="text-xl font-semibold">Lunas</h3>
            <p className={`mt-1 ${muted}`}>Satu ketuk bayar, struk tercatat di riwayat.</p>
          </div>
        </div>
      </section>

      <section className="py-16">
        <h2 className="text-3xl font-bold tracking-tighter">Batas yang jelas</h2>
        <p className={`mt-2 max-w-[65ch] ${muted}`}>
          Berjalan di testnet: dana tidak bernilai. Angka ikut konfigurasi engine.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className={tint}>
            <p className="text-3xl font-bold tracking-tight">Rp500.000</p>
            <p className={`mt-1 ${muted}`}>Maksimal per transaksi</p>
          </div>
          <div className={card}>
            <p className="text-3xl font-bold tracking-tight">Rp2.000.000</p>
            <p className={`mt-1 ${muted}`}>Maksimal per hari</p>
          </div>
          <div className={card}>
            <p className="text-3xl font-bold tracking-tight">90 detik</p>
            <p className={`mt-1 ${muted}`}>Masa berlaku tiap quote</p>
          </div>
          <div className={tint}>
            <p className="text-3xl font-bold tracking-tight">0,5% + Rp320</p>
            <p className={`mt-1 ${muted}`}>Spread dan biaya per bayar</p>
          </div>
        </div>
      </section>
    </main>
  );
}
