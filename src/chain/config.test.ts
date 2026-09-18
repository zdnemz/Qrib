import { describe, expect, it } from "vitest";

import { NETWORKS, parseNetwork } from "./config.js";

describe("chain config", () => {
  it("pins Circle's canonical USDC deployments (change only against Circle docs)", () => {
    expect(NETWORKS["base-sepolia"].usdc).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(NETWORKS["base-sepolia"].chain.id).toBe(84532);
    expect(NETWORKS.base.usdc).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(NETWORKS.base.chain.id).toBe(8453);
  });

  it("defaults to testnet — mainnet must be named explicitly", () => {
    expect(parseNetwork(undefined)).toBe("base-sepolia");
    expect(parseNetwork("")).toBe("base-sepolia");
    expect(parseNetwork("base")).toBe("base");
    expect(() => parseNetwork("ethereum")).toThrow(/unknown network/);
  });
});
