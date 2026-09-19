// Typed client for the Hono engine. Reads are no-store: payment state
// must never come from the Next cache.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !body || (body as { ok?: boolean }).ok === false) {
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

/** Fresh idempotency key per user action. */
export const idemKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type QrisParse = {
  initiation: "static" | "dynamic";
  merchantName: string;
  merchantCity: string;
  merchantPan: string;
  merchantId: string | null;
  mcc: string;
  currency: "IDR";
  amountIdr: string | null;
  next: "confirm" | "enter-amount";
};

export type Quote = {
  paymentId: string;
  asset: "USDC";
  cryptoAmount: string;
  usdcMicros: string;
  fiatAmount: string;
  rate: string;
  spreadBps: number;
  fee: { crypto: string; fiat: string };
  expiresAt: string;
};

export type Attempt = { state: string; actor: string; reason: string | null; createdAt: string };

export type Payment = {
  id: string;
  fiatAmount: string;
  currency: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
  quote: {
    asset: string;
    cryptoAmount: string;
    fiatAmount: string;
    rate: string;
    spreadBps: number;
    fee: { crypto: string; fiat: string };
    expiresAt: string;
  } | null;
  attempts: Attempt[];
};

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const parseQris = (payload: string) =>
  api<QrisParse>("/qris/parse", { method: "POST", body: JSON.stringify({ payload }) });

export const requestQuote = (body: { fiatAmount: string; merchantName?: string; merchantId?: string }) =>
  post<Quote>("/payments/quote", body);

export const authorize = (id: string) => post<{ payment: Payment }>(`/payments/${id}/authorize`, {});
export const execute = (id: string) => post<{ payment: Payment }>(`/payments/${id}/execute`, {});
export const cancel = (id: string) => post<{ payment: Payment }>(`/payments/${id}/cancel`, {});

export const getPayment = (id: string) => api<{ payment: Payment }>(`/payments/${id}`);
export const listPayments = () => api<{ payments: Payment[] }>("/payments");

export const getBalance = (address: string) =>
  api<{ balance: string; asset: string }>(`/wallet/balance?address=${encodeURIComponent(address)}`);

export const getReceive = (address: string) =>
  api<{ uri: string; usdc: string; chain: string; warning: string }>(
    `/wallet/receive?address=${encodeURIComponent(address)}`,
  );

export const idr = (n: string | number) => `Rp${Number(n).toLocaleString("id-ID")}`;

const STATUS_ID: Record<string, string> = {
  QUOTED: "Menunggu kunci kurs",
  AUTHORIZED: "Kurs terkunci",
  CRYPTO_SUBMITTED: "Dana dikirim",
  CRYPTO_CONFIRMED: "Dana terkonfirmasi",
  CONVERSION_PENDING: "Penukaran berjalan",
  FIAT_SETTLEMENT_PENDING: "Pelunasan berjalan",
  COMPLETED: "Lunas",
  FAILED: "Gagal",
  EXPIRED: "Kedaluwarsa",
  RECONCILIATION_REQUIRED: "Perlu peninjauan",
  REFUND_REQUIRED: "Perlu refund",
};

export const statusId = (s: string) => STATUS_ID[s] ?? s;
