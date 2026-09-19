import { Camera, LockKey, Receipt, Timer, Wallet } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import Magnetic from "../../../components/Magnetic";
import Reveal from "../../../components/Reveal";
import { card, muted, primary, tint } from "../../../lib/ui";

const GRID = [
  {
    icon: Wallet,
    title: "Dompet di perangkat",
    body: "Buat baru atau impor dari private key dan mnemonic. Kunci terenkripsi PBKDF2, mentah hanya di memori.",
  },
  {
    icon: Camera,
    title: "Kamera QRIS",
    body: "Pindai langsung dari kamera. Izin ditolak berarti tempel payload, bukan layar kosong.",
  },
  {
    icon: Timer,
    title: "Quote 90 detik",
    body: "Kurs terkunci dengan countdown hidup. Bayar terkunci otomatis saat kedaluwarsa.",
  },
  {
    icon: Receipt,
    title: "Struk dan riwayat",
    body: "Tiap bayar tercatat dengan jejak status lengkap, terbaru di atas, bisa dibuka per struk.",
  },
];

export default function Fitur() {
  return (
    <main className="mx-auto max-w-7xl px-4">
      <section className="py-16 md:py-24">
        <Reveal>
          <h1 className="max-w-[20ch] text-4xl font-bold tracking-tighter md:text-6xl">
            Semua yang Anda butuhkan untuk membayar.
          </h1>
          <p className={`mt-4 max-w-[55ch] text-lg leading-relaxed ${muted}`}>
            Dompet, pindai, quote, struk. Empat alat, satu alur, tanpa aplikasi bank tambahan.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {GRID.map((f, i) => (
            <Reveal key={f.title} delay={0.05 * i}>
              <div className={i % 3 === 0 ? tint : card}>
                <f.icon size={28} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
                <h2 className="mt-4 text-xl font-semibold">{f.title}</h2>
                <p className={`mt-1 max-w-[60ch] ${muted}`}>{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
        <Reveal>
          <Image
            src="https://picsum.photos/seed/qrib-pindai/1000/800"
            alt="Tangan memegang ponsel memindai kode QR"
            width={1000}
            height={800}
            loading="lazy"
            className="aspect-[5/4] w-full rounded-2xl object-cover"
          />
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Kunci Anda yang pegang.</h2>
          <p className={`mt-3 max-w-[55ch] ${muted}`}>
            Tidak ada kustodian. API tidak punya endpoint kirim karena server tidak pernah menyentuh
            kunci. Buka kunci untuk tanda tangan, kunci lagi setelah selesai.{" "}
            <Link href="/keamanan" className="underline">
              Cara kami menjaga kunci
            </Link>
          </p>
          <div className="mt-6 flex items-center gap-3">
            <LockKey size={24} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
            <p className="font-medium">Enkripsi AES-256-GCM di perangkat</p>
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-3xl py-16 text-center md:py-24">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Coba alurnya sekarang.</h2>
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
