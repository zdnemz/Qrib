import Link from "next/link";
import { idr, listPayments, statusId } from "../../lib/api";

const card = "rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800";

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
      <p className="mt-2 max-w-[65ch] text-zinc-600 dark:text-zinc-400">
        50 pembayaran terakhir, terbaru di atas.
      </p>

      {error && (
        <p role="alert" className={`${card} mt-6 border-red-300 text-red-700 dark:border-red-800 dark:text-red-300`}>
          API tidak terjangkau: {error}
        </p>
      )}

      {!error && payments.length === 0 && (
        <div className={`${card} mt-6`}>
          <p className="text-xl font-semibold">Belum ada pembayaran</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Pindai QR pertama untuk mengisi daftar ini.
          </p>
          <Link
            href="/scan"
            className="mt-4 inline-block rounded-full bg-emerald-700 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-800 active:scale-[0.98] dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300"
          >
            Pindai QR
          </Link>
        </div>
      )}

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {payments.map((p) => (
          <li key={p.id} className={card}>
            <p className="text-2xl font-bold tracking-tight">{idr(p.fiatAmount)}</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {statusId(p.status)} - {new Date(p.createdAt).toLocaleString("id-ID")}
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">{p.id}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
