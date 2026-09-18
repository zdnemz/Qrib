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

  it("rejects tampered payloads (CRC)", () => {
    expect(() => parseQris(STATIC.slice(0, -1) + "7")).toThrow(QrisError);
  });

  it("rejects non-QRIS, non-IDR, truncated and mistyped payloads", () => {
    expect(() => parseQris("hello")).toThrow(QrisError);
    expect(() => parseQris(123)).toThrow(QrisError);
    expect(() => parseQris(STATIC.slice(0, 40))).toThrow(QrisError);
    // Currency swapped 360 → 840 (USD).
    expect(() => parseQris(STATIC.replace("5303360", "5303840"))).toThrow(/IDR/);
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
