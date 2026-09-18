// First-party assisted settlement (§6.2): the two regulated legs are the
// founder's own hands, wrapped in the exact provider interfaces a licensed
// integration will later satisfy. Only first-party funds — §6.4 gates the rest.

import type {
  OffRampProvider,
  PaymentProvider,
  SettlementState,
} from "./providers.js";
import type { TaskKind, TaskStore } from "./tasks.js";

const refOf = (prefix: string, taskId: string): string => `${prefix}-${taskId}`;

export const taskIdOf = (ref: string, prefix: string): string | null => {
  if (!ref.startsWith(`${prefix}-`)) return null;
  const id = ref.slice(prefix.length + 1);
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
};

export class ManualOffRampProvider implements OffRampProvider {
  readonly name = "manual-offramp";
  constructor(private tasks: TaskStore, private ref6: bigint) {}
  async refRate6(): Promise<bigint> {
    // Reference rate is read from the founder's own exchange account screen.
    // In staging/tests it is injected; prod reads fail closed (M5 ops).
    return this.ref6;
  }
  async execute(input: { paymentId: string; usdcMicros: bigint; expectedFiatIdr: bigint }) {
    const { id } = await this.tasks.create({
      paymentId: input.paymentId,
      kind: "CONVERSION" as TaskKind,
      payload: {
        usdcMicros: input.usdcMicros.toString(),
        expectedFiatIdr: input.expectedFiatIdr.toString(),
        instruction: "sell USDC for IDR on your own exchange account, report reference + executed amount/rate",
      },
    });
    return { reference: refOf("mconv", id), status: "PENDING" as const };
  }
}

export class ManualQrisSettlementProvider implements PaymentProvider {
  readonly name = "manual-qris";
  constructor(private tasks: TaskStore) {}
  async createPayment(input: { paymentId: string; fiatAmountIdr: bigint }) {
    const { id } = await this.tasks.create({
      paymentId: input.paymentId,
      kind: "FIAT_SETTLEMENT" as TaskKind,
      payload: {
        fiatAmountIdr: input.fiatAmountIdr.toString(),
        instruction: "pay the merchant QRIS from your own bank/e-wallet app, report reference + proof",
      },
    });
    return { ref: refOf("mqris", id) };
  }
  async getPayment(ref: string): Promise<{ status: SettlementState; ref: string }> {
    const taskId = taskIdOf(ref, "mqris");
    if (!taskId) return { status: "PENDING", ref };
    const s = await this.tasks.status(taskId);
    if (s === "COMPLETED") return { status: "COMPLETED", ref };
    if (s === "FAILED") return { status: "FAILED", ref };
    return { status: "PENDING", ref };
  }
}
