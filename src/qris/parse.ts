// EMVCo Merchant-Presented QR parser for QRIS (§4.1, §7.2).
// QRIS is an EMVCo payload: 2-digit ID + 2-digit length + value, closed by
// ID 63 (CRC16-CCITT-FALSE over everything through "6304"). No dependencies.

export class QrisError extends Error {}

export type QrisData = {
  initiation: "static" | "dynamic";
  merchantName: string;
  merchantCity: string;
  merchantPan: string;
  merchantId: string | null;
  mcc: string;
  currency: "IDR";
  /** Whole-rupiah string when the QR carries an amount (dynamic), else null (static). */
  amountIdr: string | null;
  payload: string;
};

type TLV = { id: string; value: string };

function parseTLVs(s: string, context: string): TLV[] {
  const out: TLV[] = [];
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) throw new QrisError(`${context}: truncated header at offset ${i}`);
    const id = s.slice(i, i + 2);
    const len = s.slice(i + 2, i + 4);
    if (!/^\d{4}$/.test(id + len)) throw new QrisError(`${context}: bad header at offset ${i}`);
    const n = parseInt(len, 10);
    const value = s.slice(i + 4, i + 4 + n);
    if (value.length !== n) throw new QrisError(`${context}: field ${id} overruns payload`);
    out.push({ id, value });
    i += 4 + n;
  }
  return out;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the EMVCo checksum. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const once = (fields: TLV[], id: string, what: string): string => {
  const hits = fields.filter((f) => f.id === id);
  if (hits.length !== 1) throw new QrisError(`need exactly one ${what} (${id}), found ${hits.length}`);
  return hits[0].value;
};

function wholeRupiah(raw: string): string {
  if (/^\d{1,13}$/.test(raw)) return raw.replace(/^0+(?=\d)/, "") || "0";
  const m = /^(\d{1,13})\.0+$/.exec(raw);
  if (m) return m[1].replace(/^0+(?=\d)/, "") || "0";
  throw new QrisError(`non-whole-rupiah amount: ${raw}`);
}

export function parseQris(input: unknown): QrisData {
  if (typeof input !== "string") throw new QrisError("payload must be a string");
  const payload = input.trim();
  if (payload.length < 20 || !/^[\x20-\x7E]+$/.test(payload)) {
    throw new QrisError("not an EMVCo payload");
  }
  const fields = parseTLVs(payload, "root");

  if (once(fields, "00", "payload format") !== "01") throw new QrisError("unsupported payload format");
  const initiation = once(fields, "01", "point of initiation");
  if (initiation !== "11" && initiation !== "12") throw new QrisError(`bad initiation method: ${initiation}`);

  // CRC is the authenticity gate (§7.2): verify BEFORE trusting any field.
  // A payload that fails its checksum is not a QRIS code, whatever its shape.
  const last = fields[fields.length - 1];
  if (last.id !== "63" || last.value.length !== 4) throw new QrisError("payload must end with CRC (63)");
  const check = crc16ccitt(payload.slice(0, -4));
  if (check !== last.value.toUpperCase()) throw new QrisError(`CRC mismatch: want ${check}`);

  // Merchant account info (IDs 02–51). The required evidence is a merchant PAN
  // in an account block; the national ID.CO.QRIS block is preferred for the
  // merchant ID but NOT required — real payloads vary by acquirer (BANKBSI,
  // BCA, GoPay, …), and §7.2 asks us to parse real QRs, not to whitelist banks.
  const blocks = fields
    .filter((f) => f.id >= "02" && f.id <= "51")
    .map((f) => ({ subs: parseTLVs(f.value, `block ${f.id}`) }));
  if (!blocks.length) throw new QrisError("no merchant account information");

  const guidOf = (subs: TLV[]): string => (subs.find((s) => s.id === "00")?.value ?? "").toUpperCase();
  const panBlock = blocks.find((b) => b.subs.some((s) => s.id === "01"));
  const merchantPan = panBlock?.subs.find((s) => s.id === "01")?.value;
  if (!merchantPan) throw new QrisError("no merchant PAN in any account-information block");
  // Prefer the national block's merchant ID; fall back to the acquirer block's.
  const merchantId =
    blocks
      .filter((b) => guidOf(b.subs).startsWith("ID.CO.QRIS"))
      .map((b) => b.subs.find((s) => s.id === "02")?.value)
      .find((v): v is string => Boolean(v)) ??
    panBlock?.subs.find((s) => s.id === "02")?.value ??
    null;

  const mcc = once(fields, "52", "merchant category");
  if (once(fields, "53", "currency") !== "360") throw new QrisError("only IDR (360) supported in v1");
  if (once(fields, "58", "country") !== "ID") throw new QrisError("only ID country supported in v1");
  const merchantName = once(fields, "59", "merchant name");
  const merchantCity = once(fields, "60", "merchant city");

  const amountField = fields.find((f) => f.id === "54");
  if (initiation === "12" && !amountField) throw new QrisError("dynamic QR must carry amount (54)");
  if (initiation === "11" && amountField) throw new QrisError("static QR must not carry amount (54)");

  return {
    initiation: initiation === "11" ? "static" : "dynamic",
    merchantName,
    merchantCity,
    merchantPan,
    merchantId,
    mcc,
    currency: "IDR",
    amountIdr: amountField ? wholeRupiah(amountField.value) : null,
    payload,
  };
}
