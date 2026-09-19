import Link from "next/link";
import Magnetic from "../../../components/Magnetic";
import Reveal from "../../../components/Reveal";
import { card, muted, primary, tint } from "../../../lib/ui";

// Angka di bawah cermin src/engine/config.ts. Ubah satu berarti ubah dua-duanya.
const SPECS = [
  {
    v: "0,5%",
    name: "Spread kurs",
    why: "Kurs quote adalah kurs referensi dikurangi 50 bps. Selisih drift jadi pendapatan spread.",
    hot: true,
  },
  {
    v: "Rp320",
    name: "Biaya fiat",
    why: "Ditambah 0,02 USDC per bayar. Keduanya tampil di quote sebelum Anda kunci.",
    hot: true,
  },
  {
    v: "Rp500.000",
    name: "Maksimal per transaksi",
    why: "Batas penyelesaian first-party. Di atas ini quote ditolak engine.",
    hot: false,
  },
  {
    v: "90 detik",
    name: "Masa berlaku quote",
    why: "Lewat dari itu kurs hangus dan Bayar terkunci. Minta quote baru.",
    hot: false,
  },
];

export default function Biaya() {
  return (
    <main className="mx-auto max-w-7xl px-4">
      <section className="py-16 md:py-24">
        <Reveal>
          <h1 className="max-w-[20ch] text-4xl font-bold tracking-tighter md:text-6xl">
            Biaya tertulis sebelum bayar.
          </h1>
          <p className={`mt-4 max-w-[55ch] text-lg leading-relaxed ${muted}`}>
            Tidak ada potongan tersembunyi. Quote menampilkan kurs, spread, dan biaya sekaligus.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {SPECS.map((s, i) => (
            <Reveal key={s.name} delay={0.05 * i}>
              <div className={s.hot ? tint : card}>
                <p className="text-4xl font-bold tracking-tight md:text-5xl">{s.v}</p>
                <p className="mt-3 font-semibold">{s.name}</p>
                <p className={`mt-1 max-w-[55ch] ${muted}`}>{s.why}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="py-16 md:py-24">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Batas harian.</h2>
          <p className={`mt-3 max-w-[55ch] ${muted}`}>
            Rp2.000.000 per hari selama penyelesaian first-party. Cukup untuk belanja harian,
            sengaja kecil untuk masa dogfood.
          </p>
        </Reveal>
      </section>

      <section className="mx-auto max-w-3xl py-16 text-center md:py-24">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Lihat quote asli.</h2>
          <p className={`mx-auto mt-3 max-w-[45ch] ${muted}`}>
            Pindai kode, masukkan nominal, quote menghitung sisanya.
          </p>
          <div className="mt-8">
            <Magnetic>
              <Link href="/scan" className={primary}>
                Pindai QR
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
