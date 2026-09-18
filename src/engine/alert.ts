// Watchdog bark (§13–14.3). The reconciler exits non-zero on any issue;
// this POSTs the same payload to a generic webhook when configured, so a
// stuck manual leg pages someone instead of aging silently. Any chat-ops
// endpoint that accepts JSON works — nothing vendor-specific here.

export type AlertResult = "sent" | "skipped" | "failed";

export async function alertIfNeeded(
  url: string | undefined,
  payload: { issues: unknown[]; stuck: string[] },
): Promise<AlertResult> {
  if (issuesQuiet(payload)) return "skipped";
  if (!url) return "skipped";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "qris-wallet-reconcile", ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

const issuesQuiet = (payload: { issues: unknown[]; stuck: string[] }): boolean =>
  payload.issues.length === 0 && payload.stuck.length === 0;
