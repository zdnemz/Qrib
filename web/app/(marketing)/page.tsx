import { ArrowRight, Camera, Timer, Wallet } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import Magnetic from "../../components/Magnetic";
import Reveal from "../../components/Reveal";
import Tilt from "../../components/Tilt";
import { card, muted, primary, secondary, tint } from "../../lib/ui";

// Marketing home: premium consumer. Airy sections, real photography,
// one accent (emerald), zero eyebrows. Motion: reveals + magnetic + tilt.

const STEPS = [
  {
    icon: Camera,
    title: "Pindai",
    body: "Kamera membaca kode langsung, atau tempel payload. Nominal dinamis terbaca otomatis, nominal statis tinggal isi sendiri.",
    wide: true,
  },
  {
    icon: Timer,
    title: "Kunci",
    body: "Minta quote dan kunci kurs 90 detik. Countdown terlihat, Bayar terkunci saat kedaluwarsa.",
    wide: false,
  },
  {
    icon: Wallet,
    title: "Lunas",
    body: "Satu ketuk bayar dari dompet perangkat. Struk tercatat di riwayat.",
    wide: false,
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4">
      <section className="grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
        <Reveal>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tighter md:text-7xl">
            Bayar QRIS pakai USDC.
          </h1>
          <p className={`mt-5 max-w-[45ch] text-lg leading-relaxed ${muted}`}>
            USDC yang selama ini diam kini belanja. Pindai, kunci kurs, lunasi dalam rupiah.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Magnetic>
              <Link href="/scan" className={primary}>
                Pindai QR
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/fitur" className={secondary}>
                Jelajahi fitur
              </Link>
            </Magnetic>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <Tilt>
            <Image
              src="https://picsum.photos/seed/qrib-kasir/1200/960"
              alt="Kasir warung kopi memegang kode QRIS"
              width={1200}
              height={960}
              priority
              className="aspect-[5/4] w-full rounded-2xl object-cover"
            />
          </Tilt>
          <div className={`${tint} mt-6`}>
            <p className={`font-mono text-xs ${muted}`}>STRUK</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">Rp27.500</p>
            <p className={`mt-1 text-sm ${muted}`}>Kopi Kenangan</p>
            <p className="mt-4 inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300">
              Lunas
            </p>
          </div>
          <p className={`mt-2 text-sm ${muted}`}>Contoh struk.</p>
        </Reveal>
      </section>

      <section className="py-16 md:py-24">
        <Reveal>
          <h2 className="max-w-[20ch] text-3xl font-bold tracking-tighter md:text-5xl">
            Tiga langkah dari pindai sampai lunas.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={0.05 * i} className={s.wide ? "md:col-span-2" : undefined}>
              <div className={s.wide ? tint : card}>
                <s.icon size={28} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
                <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
                <p className={`mt-1 max-w-[65ch] ${muted}`}>{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="py-16 md:py-24">
        <Reveal>
          <Image
            src="https://picsum.photos/seed/qrib-warung/1600/800"
            alt="Suasana warung makan Indonesia yang ramai"
            width={1600}
            height={800}
            loading="lazy"
            className="aspect-[2/1] w-full rounded-2xl object-cover"
          />
          <p className={`mt-3 max-w-[65ch] ${muted}`}>
           Merchant tidak berubah. Mereka terima rupiah seperti biasa, dana USDC Anda yang bekerja.
          </p>
        </Reveal>
      </section>

      <section className="py-16 md:py-24">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tighter md:text-5xl">Batas yang jelas.</h2>
          <p className={`mt-3 max-w-[65ch] ${muted}`}>
            Berjalan di testnet: dana tidak bernilai. Angka ikut konfigurasi engine.{" "}
            <Link href="/biaya" className="underline">
              Rincian biaya
            </Link>
          </p>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {[
            { v: "Rp500.000", l: "Maksimal per transaksi", hot: true },
            { v: "Rp2.000.000", l: "Maksimal per hari", hot: false },
            { v: "90 detik", l: "Masa berlaku tiap quote", hot: false },
            { v: "0,5% + Rp320", l: "Spread dan biaya per bayar", hot: true },
          ].map((s, i) => (
            <Reveal key={s.l} delay={0.05 * i}>
              <div className={s.hot ? tint : card}>
                <p className="text-3xl font-bold tracking-tight md:text-4xl">{s.v}</p>
                <p className={`mt-1 ${muted}`}>{s.l}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl py-16 text-center md:py-24">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tighter md:text-5xl">
            Kopi berikutnya pakai USDC.
          </h2>
          <p className={`mx-auto mt-3 max-w-[45ch] ${muted}`}>
            Buat dompet di perangkat, isi USDC testnet, pindai kode pertama.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Magnetic>
              <Link href="/scan" className={`${primary} inline-flex items-center gap-2`}>
                Pindai QR <ArrowRight size={18} weight="bold" />
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
