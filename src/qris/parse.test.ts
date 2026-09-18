import { describe, expect, it } from "vitest";

import { crc16ccitt, parseQris, QrisError } from "./parse.js";

// Fixtures built by hand per the EMVCo layout; CRCs computed independently
// with Python binascii.crc_hqx — never by the implementation under test.
// Block 51 mirrors reality: GUID ID.CO.QRIS.WWW, sub-02 = merchant ID, sub-03 = network.
const STATIC =
  "00020101021126480014ID.CO.QRIS.WWW011993600814000000012340203UMI5204541153033605802ID5913KOPI KENANGAN6007JAKARTA63046536";
const DYNAMIC =
  "00020101021226480014ID.CO.QRIS.WWW011993600814000000012340203UMI5204541153033605405150005802ID5911TOKO BERKAH6007BANDUNG63043574";
// A REAL merchant QRIS (BSI acquirer), contributed by scanning the merchant's
// printed QR. It has TWO account-information blocks — 26 carries the PAN, 51
// is the national QRIS block with only the merchant ID — which the original
// parser got wrong by assuming the ID.CO.QRIS block always holds the PAN.
const REAL_STATIC =
  "00020101021126640017ID.CO.BANKBSI.WWW0118936004510000116701021000002267330303UMI51440014ID.CO.QRIS.WWW0215ID10221981718480303UMI5204541153033605802ID5909KIOS DEWI6010BANJARBARU61057071463042C39";

describe("crc16", () => {
  it("matches the standard check value", () => {
    expect(crc16ccitt("123456789")).toBe("29B1"); // CRC-16/CCITT-FALSE check
  });
});

describe("parseQris", () => {
  it("parses a static QR (no amount — user enters it)", () => {
    expect(parseQris(STATIC)).toEqual({
      initiation: "static",
      merchantName: "KOPI KENANGAN",
      merchantCity: "JAKARTA",
      merchantPan: "9360081400000001234",
      merchantId: "UMI", // fixture's sub-02; real ones carry the national merchant ID
      mcc: "5411",
      currency: "IDR",
      amountIdr: null,
      payload: STATIC,
    });
  });

  it("parses a dynamic QR (amount detected)", () => {
    const r = parseQris(DYNAMIC);
    expect(r.initiation).toBe("dynamic");
    expect(r.amountIdr).toBe("15000");
    expect(r.merchantName).toBe("TOKO BERKAH");
  });

  it("parses a real merchant QRIS with two account-information blocks", () => {
    expect(parseQris(REAL_STATIC)).toEqual({
      initiation: "static",
      merchantName: "KIOS DEWI",
      merchantCity: "BANJARBARU",
      merchantPan: "936004510000116701", // from block 26 (BSI acquirer)
      merchantId: "ID1022198171848", // from block 51 (national QRIS)
      mcc: "5411",
      currency: "IDR",
      amountIdr: null,
      payload: REAL_STATIC,
    });
  });

  // Acquirer GUIDs vary in the wild. §7.2 asks us to parse real QRs, not to
  // whitelist banks, so an acquirer block with a PAN is sufficient; the
  // national ID.CO.QRIS block is preferred for the merchant ID, not required.
  // CRCs here were recomputed for the test (the source fixtures had placeholder
  // "ABCD" checksums, which the parser correctly rejected before this).
  it("accepts acquirer-specific GUIDs (BCA, GoPay, BNI) without a QRIS block", () => {
    const bca =
      "00020101021226650013ID.CO.BCA.WWW011893600000000000000202151234567890123460303UMI5204581253033605405500005802ID5934TOKO MAKANAN DAN MINUMAN SEDERHANA6007BANDUNG61054012362120108INV123456304" +
      crc16ccitt("00020101021226650013ID.CO.BCA.WWW011893600000000000000202151234567890123460303UMI5204581253033605405500005802ID5934TOKO MAKANAN DAN MINUMAN SEDERHANA6007BANDUNG61054012362120108INV123456304");
    const r = parseQris(bca);
    expect(r.merchantPan).toBe("936000000000000002");
    expect(r.merchantId).toBe("123456789012346");
    expect(r.initiation).toBe("dynamic");
    expect(r.amountIdr).toBe("50000");
    expect(r.mcc).toBe("5812");
    expect(r.merchantName).toBe("TOKO MAKANAN DAN MINUMAN SEDERHANA");

    const gopay =
      "00020101021126670015ID.CO.GOPAY.WWW011893600000000000000302151234567890123470303UMI5204411153033605802ID5919APOTEK SEHAT SELALU6008SURABAYA61056012362006304" +
      crc16ccitt("00020101021126670015ID.CO.GOPAY.WWW011893600000000000000302151234567890123470303UMI5204411153033605802ID5919APOTEK SEHAT SELALU6008SURABAYA61056012362006304");
    const g = parseQris(gopay);
    expect(g.initiation).toBe("static");
    expect(g.amountIdr).toBeNull();
    expect(g.merchantName).toBe("APOTEK SEHAT SELALU");
  });

  it("rejects a payload missing the currency field", () => {
    // Tag 54 (amount) where 53 (currency) belongs — a malformed payload. The
    // parser must refuse rather than assume IDR.
    const body =
      "00020101021226650013ID.CO.OVO.WWW011893600000000000000602151234567890123500303UMI5204594254062500005802ID5942TOKO ELEKTRONIK DAN PERALATAN RUMAH TANGGA6005MEDAN61052011162006304";
    expect(() => parseQris(body + crc16ccitt(body))).toThrow(/currency/);
  });

  it("rejects tampered payloads (CRC)", () => {
    expect(() => parseQris(STATIC.slice(0, -1) + "7")).toThrow(QrisError);
  });

  it("rejects non-QRIS, non-IDR, truncated and mistyped payloads", () => {
    expect(() => parseQris("hello")).toThrow(QrisError);
    expect(() => parseQris(123)).toThrow(QrisError);
    expect(() => parseQris(STATIC.slice(0, 40))).toThrow(QrisError);
    // Currency swapped 360 → 840 (USD), CRC recomputed so we reach the currency
    // check rather than failing at the (earlier) checksum gate.
    const usdBody = STATIC.replace("5303360", "5303840").slice(0, -4);
    expect(() => parseQris(usdBody + crc16ccitt(usdBody))).toThrow(/IDR/);
    // Valid CRC but static carrying an amount / dynamic missing one.
    expect(() =>
      parseQris(
        "00020101021126480014ID.CO.QRIS.WWW011993600814000000012340203UMI5204541153033605405275005802ID5913KOPI KENANGAN6007JAKARTA6304DEA8",
      ),
    ).toThrow(/static QR must not carry amount/);
    expect(() =>
      parseQris(
        "00020101021226480014ID.CO.QRIS.WWW011993600814000000012340203UMI5204541153033605802ID5911TOKO BERKAH6007BANDUNG6304050A",
      ),
    ).toThrow(/dynamic QR must carry amount/);
  });
});
