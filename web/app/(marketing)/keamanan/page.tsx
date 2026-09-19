import { ArrowsClockwise, Fingerprint, LockKey, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import Magnetic from "../../../components/Magnetic";
import Reveal from "../../../components/Reveal";
import { card, muted, primary } from "../../../lib/ui";

const RULES = [
  {
    icon: LockKey,
    title: "Kunci tidak pernah transit",
    body: "Tidak ada endpoint kirim di API karena tidak ada alasan server menyentuh kunci. Tanda tangan terjadi di perangkat, kunci mentah hanya di memori.",
  },
  {
    icon: Fingerprint,
    title: "Tiap transisi tercatat",
    body: "Quote, authorize, execute: idempoten dan terekam sebagai jejak attempts. Boolean lunas bukan sistem pembayaran.",
  },
  {
    icon: ArrowsClockwise,
    title: "Rekonsiliasi terjadwal",
    body: "Chain lawan provider lawan ledger dicek berkala. Selisih berbunyi, bukan diam.",
  },
  {
    icon: ShieldCheck,
    title: "Testnet dulu",
    body: "Berjalan di Base Sepolia: dana tidak bernilai. Mainnet menunggu mitra berlisensi.",
  },
];

export default function Keamanan() {
  return (
    <main className="mx-auto max-w-7xl px-4">
      <section className="grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
        <Reveal>
          <h1 className="text-4xl font-bold tracking-tighter md:text-6xl">Uang dulu, estetika kemudian.</h1>
          <p className={`mt-4 max-w-[55ch] text-lg leading-relaxed ${muted}`}>
            Dompet non-kustodian dengan batas eksplisit. Yang belum aman tidak diluncurkan.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <Image
            src="https://picsum.photos/seed/qrib-aman/1000/800"
            alt="Gembok pada pintu besi"
            width={1000}
            height={800}
            loading="lazy"
            className="aspect-[5/4] w-full rounded-2xl object-cover"
          />
        </Reveal>
      </section>

      <section className="py-16 md:py-24">
        <div className="grid gap-6 md:grid-cols-2">
          {RULES.map((r, i) => (
            <Reveal key={r.title} delay={0.05 * i}>
              <div className={card}>
                <r.icon size={28} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
                <h2 className="mt-4 text-xl font-semibold">{r.title}</h2>
                <p className={`mt-1 max-w-[60ch] ${muted}`}>{r.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl py-16 text-center md:py-24">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Masih ragu, tanya dulu.</h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Magnetic>
              <Link href="/faq" className={primary}>
                Buka FAQ
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
