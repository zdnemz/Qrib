import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { checkedAddress, parseUsdcAmount, receiveInfo } from "./usdc.js";

const HOLDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("usdc helpers", () => {
  it("parses display amounts to 6dp units, never float", () => {
    expect(parseUsdcAmount("1.50")).toBe(1_500_000n);
    expect(parseUsdcAmount("27500")).toBe(27_500_000_000n);
    expect(() => parseUsdcAmount("1.1234567")).toThrow(/invalid/);
    expect(() => parseUsdcAmount("-5")).toThrow(/invalid/);
    expect(() => parseUsdcAmount("abc")).toThrow(/invalid/);
  });

  it("checksums addresses, rejects garbage", () => {
    expect(checkedAddress(HOLDER.toLowerCase())).toBe(HOLDER);
    expect(() => checkedAddress("0xnope")).toThrow(/invalid address/);
    expect(() => checkedAddress(undefined)).toThrow(/invalid address/);
  });

  it("builds an EIP-681 receive URI with chain + asset context", () => {
    const r = receiveInfo("base-sepolia", HOLDER, "1.50");
    expect(r.chainId).toBe(84532);
    expect(r.usdc).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(r.uri).toContain("ethereum:0x036CbD53842c5426634e7929541eC2318f3dCF7e@84532/transfer?");
    expect(r.uri).toContain(`address=${HOLDER}`);
    expect(r.uri).toContain("uint256=1500000");
    expect(r.warning).toMatch(/Base Sepolia only/);
  });

  it("signs a USDC transfer offline that recovers to the sender (send path, no funds needed)", async () => {
    // Fully offline: proves key → account → calldata → signature pipeline.
    // Broadcasting is the only step that needs a funded wallet (faucet.circle.com).
    const sender = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7b4d3ff3c0",
    );
    const data = encodeFunctionData({
      abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
      functionName: "transfer",
      args: [HOLDER, parseUsdcAmount("0.01")],
    });
    expect(data).toContain("a9059cbb"); // transfer(address,uint256) selector
    const signed = await sender.signTransaction({
      chainId: 84532,
      to: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      data,
      nonce: 0,
      gas: 60000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
    // Signed above as EIP-1559 (0x02 envelope); the generic hex type needs narrowing.
    const typed = signed as `0x02${string}`;
    expect(await recoverTransactionAddress({ serializedTransaction: typed })).toBe(sender.address);
  });
});
