import Link from "next/link";
import { idr, listPayments, statusId } from "../../lib/api";
import { card, errorCard, muted, primary } from "../../lib/ui";

export default async function History() {
  let payments: Awaited<ReturnType<typeof listPayments>>["payments"] = [];
  let error: string | null = null;
  try {
    payments = (await listPayments()).payments;
  } catch (e) {
    error = e instanceof Error ? e.message : "unknown error";
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-4xl font-bold tracking-tighter">Riwayat</h1>
      <p className={`mt-2 max-w-[65ch] ${muted}`}>50 pembayaran terakhir, terbaru di atas.</p>

      {error && (
        <p role="alert" className={`${errorCard} mt-6`}>
          API tidak terjangkau: {error}
        </p>
      )}

      {!error && payments.length === 0 && (
        <div className={`${card} mt-6`}>
          <p className="text-xl font-semibold">Belum ada pembayaran</p>
          <p className={`mt-1 ${muted}`}>Pindai QR pertama untuk mengisi daftar ini.</p>
          <Link href="/scan" className={`${primary} mt-4 inline-block`}>
            Pindai QR
          </Link>
        </div>
      )}

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {payments.map((p) => (
          <li key={p.id}>
            <Link href={`/history/${p.id}`} className={`${card} block transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900`}>
              <p className="text-2xl font-bold tracking-tight">{idr(p.fiatAmount)}</p>
              <p className={`mt-1 text-sm ${muted}`}>
                {statusId(p.status)} - {new Date(p.createdAt).toLocaleString("id-ID")}
              </p>
              <p className={`mt-1 font-mono text-xs ${muted}`}>{p.id}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
