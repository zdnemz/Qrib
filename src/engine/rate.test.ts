// The manual reference rate comes from the founder's exchange screen and
// carries sub-rupiah precision (e.g. 17609.77). Rounding it would misprice
// every quote, so it is parsed to 6dp and the parse is pinned here.

import { afterEach, describe, expect, it } from "vitest";

import { providersFromEnv } from "./service.js";
import { testDb } from "../../test/helpers.js";

const db = testDb();

/** Reach the manual off-ramp's rate via refRate6(); env-driven, so set it. */
async function rateFromEnv(raw: string): Promise<bigint> {
  process.env.ENGINE_OFFRAMP = "manual";
  process.env.MANUAL_IDR_PER_USDC = raw;
  const { offRamp } = providersFromEnv(db);
  return offRamp.refRate6();
}

afterEach(() => {
  delete process.env.ENGINE_OFFRAMP;
  delete process.env.MANUAL_IDR_PER_USDC;
});

describe("manual rate parsing", () => {
  it("accepts decimals and scales to 6dp without loss", async () => {
    expect(await rateFromEnv("17609.77")).toBe(17_609_770_000n);
    expect(await rateFromEnv("17609")).toBe(17_609_000_000n);
    expect(await rateFromEnv("17609.123456")).toBe(17_609_123_456n);
    expect(await rateFromEnv("0.5")).toBe(500_000n);
  });

  it("fails closed on malformed or over-precise rates", async () => {
    for (const bad of ["", "abc", "1,500", "-5", "17609.1234567", "1e5"]) {
      await expect(rateFromEnv(bad)).rejects.toThrow(/MANUAL_IDR_PER_USDC/);
    }
  });

  it("refuses a missing rate rather than defaulting", async () => {
    process.env.ENGINE_OFFRAMP = "manual";
    delete process.env.MANUAL_IDR_PER_USDC;
    expect(() => providersFromEnv(db)).toThrow(/MANUAL_IDR_PER_USDC/);
  });
});
