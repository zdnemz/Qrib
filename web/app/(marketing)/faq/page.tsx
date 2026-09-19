import Link from "next/link";
import Magnetic from "../../../components/Magnetic";
import Reveal from "../../../components/Reveal";
import { muted, primary } from "../../../lib/ui";

const GROUPS = [
  {
    title: "Dompet",
    items: [
      {
        q: "Di chain apa Qrib berjalan?",
        a: "Base Sepolia untuk testnet. USDC 6 desimal, faucet Circle untuk isi saldo coba.",
      },
      {
        q: "Siapa yang memegang kunci saya?",
        a: "Anda sendiri. Kunci terenkripsi AES-256-GCM di perangkat, server tidak punya salinan dan tidak ada endpoint kirim.",
      },
      {
        q: "Lupa passphrase berarti apa?",
        a: "Keystore tidak bisa dibuka. Impor ulang dari private key atau mnemonic, lalu buat passphrase baru.",
      },
    ],
  },
  {
    title: "Pembayaran",
    items: [
      {
        q: "Bagaimana cara bayar?",
        a: "Pindai kode QRIS, kunci quote 90 detik, ketuk Bayar. Struk tercatat di riwayat dengan jejak status.",
      },
      {
        q: "QR statis dan dinamis bedanya apa?",
        a: "Dinamis sudah berisi nominal dan langsung konfirmasi. Statis meminta Anda mengisi nominal rupiah dulu.",
      },
      {
        q: "Quote kedaluwarsa saat mau bayar?",
        a: "Tombol Bayar terkunci otomatis. Minta quote baru, kurs dihitung ulang.",
      },
    ],
  },
  {
    title: "Biaya dan batas",
    items: [
      {
        q: "Berapa biayanya?",
        a: "Spread 0,5% ditambah Rp320 dan 0,02 USDC per bayar. Semua tampil di quote sebelum dikunci.",
      },
      {
        q: "Berapa batasnya?",
        a: "Rp500.000 per transaksi dan Rp2.000.000 per hari selama penyelesaian first-party.",
      },
    ],
  },
];

export default function Faq() {
  return (
    <main className="mx-auto max-w-7xl px-4">
      <section className="py-16 md:py-24">
        <Reveal>
          <h1 className="max-w-[20ch] text-4xl font-bold tracking-tighter md:text-6xl">
            Ditanyakan, dijawab.
          </h1>
          <p className={`mt-4 max-w-[55ch] text-lg leading-relaxed ${muted}`}>
            Delapan jawaban pendek. Tidak ketemu milik Anda, mulai dari memindai.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-12 md:grid-cols-2">
          {GROUPS.map((g, gi) => (
            <Reveal key={g.title} delay={0.05 * gi}>
              <div>
                <h2 className="text-xl font-semibold">{g.title}</h2>
                <div className="mt-4 space-y-3">
                  {g.items.map((f) => (
                    <details
                      key={f.q}
                      className="group rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
                    >
                      <summary className="cursor-pointer font-medium">{f.q}</summary>
                      <p className={`mt-2 max-w-[60ch] ${muted}`}>{f.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl py-16 text-center md:py-24">
        <Reveal>
          <div className="mt-2">
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
