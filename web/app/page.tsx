import Link from "next/link";

// Landing: trust-first. Four sections, zero eyebrows, one accent (emerald),
// buttons pill + cards 16px. Motion 3: hover and active states only.
const btn =
  "inline-block rounded-full px-6 py-3 text-base font-semibold transition-colors active:scale-[0.98]";
const card = "rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4">
      <section className="grid min-h-[calc(100dvh-8rem)] items-center gap-10 py-12 md:grid-cols-2">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter md:text-6xl">
            Bayar QRIS pakai USDC.
          </h1>
          <p className="mt-4 max-w-[65ch] text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Pindai kode QRIS, kunci kurs, lunasi dalam rupiah. Saldo terlihat, tiap langkah
            tercatat.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/scan"
              className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300`}
            >
              Pindai QR
            </Link>
            <Link
              href="/history"
              className={`${btn} border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`}
            >
              Lihat riwayat
            </Link>
          </div>
        </div>
        <div>
          <div className={`${card} bg-zinc-50 dark:bg-zinc-900`}>
            <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">STRUK</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">Rp27.500</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Kopi Kenangan</p>
            <p className="mt-4 inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300">
              Lunas
            </p>
          </div>
          {/* contoh */}
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Contoh struk.</p>
        </div>
      </section>

      <section className="py-16">
        <h2 className="text-3xl font-bold tracking-tighter">Cara kerja</h2>
        <p className="mt-2 max-w-[65ch] text-zinc-600 dark:text-zinc-400">
          Tiga langkah dari pindai sampai lunas, tanpa aplikasi bank tambahan.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className={`${card} bg-zinc-50 md:col-span-2 dark:bg-zinc-900`}>
            <h3 className="text-xl font-semibold">Pindai</h3>
            <p className="mt-1 max-w-[65ch] text-zinc-600 dark:text-zinc-400">
              Tempel payload QRIS atau pindai dari kamera. Nominal dinamis langsung terbaca,
              nominal statis tinggal isi sendiri.
            </p>
          </div>
          <div className={card}>
            <h3 className="text-xl font-semibold">Kunci</h3>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              Minta quote dan kunci kurs 90 detik sebelum bayar.
            </p>
          </div>
          <div className={card}>
            <h3 className="text-xl font-semibold">Lunas</h3>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              Satu ketuk bayar, struk tercatat di riwayat.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16">
        <h2 className="text-3xl font-bold tracking-tighter">Batas yang jelas</h2>
        <p className="mt-2 max-w-[65ch] text-zinc-600 dark:text-zinc-400">
          Berjalan di testnet: dana tidak bernilai. Angka ikut konfigurasi engine.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className={card}>
            <p className="text-3xl font-bold tracking-tight">Rp500.000</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">Maksimal per transaksi</p>
          </div>
          <div className={card}>
            <p className="text-3xl font-bold tracking-tight">Rp2.000.000</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">Maksimal per hari</p>
          </div>
          <div className={card}>
            <p className="text-3xl font-bold tracking-tight">90 detik</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">Masa berlaku tiap quote</p>
          </div>
          <div className={card}>
            <p className="text-3xl font-bold tracking-tight">0,5% + Rp320</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">Spread dan biaya per bayar</p>
          </div>
        </div>
      </section>
    </main>
  );
}
