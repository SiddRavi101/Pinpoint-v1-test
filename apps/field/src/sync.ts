/**
 * Sync client: sends the whole log (the server is idempotent), records the
 * server's receipt as a sync_confirmed event, and deletes charts once the
 * retention rule allows. Requests carry no patient data in the URL.
 */
import { ChartLog, retentionState, type ChartEvent } from "@pinpoint/core";

export interface SyncConfig {
  serverUrl: string;
  deviceId: string;
  token: string;
}

export interface Receipt {
  receiptId: string;
  serverEventCount: number;
  confirmedAt: string;
}

export async function uploadChart(log: ChartLog, cfg: SyncConfig, fetchImpl: typeof fetch = fetch): Promise<ChartEvent | null> {
  const res = await fetchImpl(`${cfg.serverUrl.replace(/\/$/, "")}/v1/charts/${encodeURIComponent(log.chartId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ events: log.events }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Sync failed (${res.status}): ${body.error ?? "server error"}`);
  }
  const receipt = (await res.json()) as Receipt;
  const last = [...log.events].reverse().find((e) => e.kind === "sync_confirmed");
  const prevCount = last?.kind === "sync_confirmed" ? last.payload.serverEventCount : 0;
  const maxDataSeq = Math.max(0, ...log.events.filter((e) => e.kind !== "sync_confirmed").map((e) => e.seq));
  // Only record a receipt when it confirms chart data that wasn't confirmed before.
  if (prevCount >= maxDataSeq || receipt.serverEventCount <= prevCount) return null;
  return log.recordSyncConfirmed(receipt);
}

/** Charts whose retention rule says they can now be removed from the phone. */
export function deletableCharts(logs: ChartLog[], now: Date): string[] {
  return logs.filter((l) => retentionState(l.events, now).state === "deletable").map((l) => l.chartId);
}
