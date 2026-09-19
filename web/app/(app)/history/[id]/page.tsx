import Link from "next/link";
import { getPayment, idr, statusId } from "../../../../lib/api";
import { card, errorCard, muted, secondary, tint } from "../../../../lib/ui";

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let payment: Awaited<ReturnType<typeof getPayment>>["payment"] | null = null;
  let error: string | null = null;
  try {
    payment = (await getPayment(id)).payment;
  } catch (e) {
    error = e instanceof Error ? e.message : "unknown error";
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-4xl font-bold tracking-tighter">Struk</h1>
      <p className={`mt-2 max-w-[65ch] font-mono text-sm ${muted}`}>{id}</p>

      {error && (
        <p role="alert" className={`${errorCard} mt-6`}>
          API tidak terjangkau: {error}
        </p>
      )}

      {payment && (
        <>
          <section className={`${tint} mt-6`}>
            <p className="text-3xl font-bold tracking-tight">{idr(payment.fiatAmount)}</p>
            <p className={`mt-1 ${muted}`}>{statusId(payment.status)}</p>
            {payment.failureReason && (
              <p className="mt-1 text-red-700 dark:text-red-300">{payment.failureReason}</p>
            )}
          </section>

          {payment.quote && (
            <section className={`${card} mt-6`}>
              <h2 className="text-xl font-semibold">Quote</h2>
              <p className={`mt-2 font-mono text-sm ${muted}`}>
                {payment.quote.cryptoAmount} {payment.quote.asset} - kurs {payment.quote.rate}
              </p>
              <p className={`mt-1 font-mono text-sm ${muted}`}>
                Biaya {payment.quote.fee.crypto} USDC + Rp{payment.quote.fee.fiat}
              </p>
            </section>
          )}

          <section className={`${card} mt-6`}>
            <h2 className="text-xl font-semibold">Jejak status</h2>
            <ol className={`mt-4 space-y-1 font-mono text-sm ${muted}`}>
              {payment.attempts.map((a, i) => (
                <li key={i}>
                  {statusId(a.state)} - {new Date(a.createdAt).toLocaleString("id-ID")}
                </li>
              ))}
            </ol>
            <Link href="/history" className={`${secondary} mt-6 inline-block`}>
              Lihat riwayat
            </Link>
          </section>
        </>
      )}
    </main>
  );
}
