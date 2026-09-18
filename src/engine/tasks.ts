// Operator task queue (§6.2, §10): the manual legs are provider
// implementations backed by human work. execute()/createPayment() file a
// task and return pending; a signed operator action completes it and the
// engine resumes. Everything downstream cannot tell manual from licensed.

import { eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { operatorTasks } from "../db/schema.js";

export type TaskKind = "CONVERSION" | "FIAT_SETTLEMENT";
export type TaskStatus = "PENDING" | "COMPLETED" | "FAILED";

export type Task = typeof operatorTasks.$inferSelect;

/** DB-agnostic handle the manual providers use — the service wires storage. */
export interface TaskStore {
  create(input: { paymentId: string; kind: TaskKind; payload: Record<string, unknown> }): Promise<{ id: string }>;
  status(taskId: string): Promise<TaskStatus | null>;
}

export function dbTaskStore(db: Db): TaskStore {
  return {
    async create(input) {
      const [row] = await db
        .insert(operatorTasks)
        .values({ paymentId: input.paymentId, kind: input.kind, payload: input.payload })
        .returning();
      return { id: row.id };
    },
    async status(taskId) {
      const rows = await db.select().from(operatorTasks).where(eq(operatorTasks.id, taskId)).limit(1);
      return (rows[0]?.status as TaskStatus | undefined) ?? null;
    },
  };
}

export async function getTask(db: Db, id: string): Promise<Task | undefined> {
  const rows = await db.select().from(operatorTasks).where(eq(operatorTasks.id, id)).limit(1);
  return rows[0];
}

export async function listTasks(db: Db, status?: TaskStatus): Promise<Task[]> {
  const rows = await db.select().from(operatorTasks);
  return status ? rows.filter((t) => t.status === status) : rows;
}
