// Reconciliation runbook (§14.3): `pnpm reconcile [paymentId|--all]`.
// Exit non-zero on any issue — wire the cron/alerting to that (M5).

import "dotenv/config";

import { db, pool } from "../src/db/index.js";
import { alertIfNeeded } from "../src/engine/alert.js";
import { reconcileAll, reconcilePayment } from "../src/engine/reconcile.js";

async function main() {
  const arg = process.argv[2];
  if (arg && arg !== "--all") {
    const issues = await reconcilePayment(db, arg);
    console.log(JSON.stringify({ paymentId: arg, issues }, null, 2));
    process.exit(issues.length ? 1 : 0);
  }
  const { issues, stuck } = await reconcileAll(db);
  console.log(JSON.stringify({ issues, stuck }, null, 2));
  if (issues.length || stuck.length) {
    // Watchdog bark (§13): non-zero exit for cron AND a push when configured.
    const alerted = await alertIfNeeded(process.env.ALERT_WEBHOOK_URL, { issues, stuck });
    console.log(JSON.stringify({ alerted }));
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  })
  .finally(() => pool.end());
