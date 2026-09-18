// Typed client for the Hono API. All reads are no-store — payment state
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

/** Fresh idempotency key per user action (§12). */
export const idemKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type QrisParse = {
  initiation: "static" | "dynamic";
  merchantName: string;
  merchantCity: string;
  merchantPan: string;
  mcc: string;
  currency: "IDR";
  amountIdr: string | null;
  next: "confirm" | "enter-amount";
};

export type Quote = {
  paymentId: string;
  asset: string;
  cryptoAmount: string;
  fiatAmount: string;
  rate: string;
  spreadBps: number;
  fee: { crypto: string; fiat: string };
  expiresAt: string;
};

export type Attempt = { state: string; createdAt: string };
export type Payment = {
  id: string;
  status: string;
  fiatAmount: string;
  currency: string;
  failureReason: string | null;
  createdAt: string;
  quote: {
    cryptoAmount: string;
    fiatAmount: string;
    rate: string;
    spreadBps: number;
    fee: { crypto: string; fiat: string };
    expiresAt: string;
  } | null;
  attempts: Attempt[];
};

export const parseQris = (payload: string) =>
  api<QrisParse>("/qris/parse", { method: "POST", body: JSON.stringify({ payload }) });

export const requestQuote = (body: { fiatAmount: string; merchantName?: string; merchantId?: string }) =>
  api<Quote>("/payments/quote", {
    method: "POST",
    headers: { "Idempotency-Key": idemKey() },
    body: JSON.stringify(body),
  });

export const authorize = (id: string) =>
  api<{ payment: Payment }>(`/payments/${id}/authorize`, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey() },
  });

export const execute = (id: string) =>
  api<{ payment: Payment }>(`/payments/${id}/execute`, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey() },
    body: JSON.stringify({}),
  });

export const getPayment = (id: string) => api<{ payment: Payment }>(`/payments/${id}`);

export const listPayments = () => api<{ payments: Payment[] }>("/payments");

export const getBalance = (address: string) =>
  api<{ balance: string }>(`/wallet/balance?address=${address}`);

export const getReceive = (address: string) =>
  api<{ uri: string; usdc: string; chain: string; warning: string }>(
    `/wallet/receive?address=${address}`,
  );

export const idr = (n: string) => `Rp${Number(n).toLocaleString("id-ID")}`;
