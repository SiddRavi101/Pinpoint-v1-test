/**
 * Sync-then-delete rule (REQ-030..032, HAZ-06):
 * a chart may be deleted from the phone only when it is closed, the server
 * has confirmed every event, and 12 hours have passed since that
 * confirmation. Unsynced events older than 24 hours raise a warning.
 */
import type { ChartEvent } from "./types.js";

export const DELETE_AFTER_CONFIRM_MS = 12 * 60 * 60 * 1000;
export const WARN_UNSYNCED_MS = 24 * 60 * 60 * 1000;

export type RetentionState =
  | { state: "keep"; reason: string; deleteAfter?: string }
  | { state: "deletable"; reason: string }
  | { state: "warn_unsynced"; reason: string; unsyncedSince: string };

export function retentionState(events: readonly ChartEvent[], now: Date): RetentionState {
  const closed = events.find((e) => e.kind === "chart_closed");
  const receipts = events.filter((e): e is Extract<ChartEvent, { kind: "sync_confirmed" }> => e.kind === "sync_confirmed");
  const latest = receipts[receipts.length - 1];
  // Receipts confirm every event with seq <= serverEventCount.
  const confirmedCount = latest ? latest.payload.serverEventCount : 0;
  const unconfirmed = events.filter((e) => e.kind !== "sync_confirmed" && e.seq > confirmedCount);

  if (unconfirmed.length > 0) {
    const firstUnsynced = unconfirmed[0]!;
    const since = new Date(firstUnsynced.loggedAt);
    if (now.getTime() - since.getTime() >= WARN_UNSYNCED_MS) {
      return { state: "warn_unsynced", reason: "Not sent to the server for more than 24 hours. Connect to sync.", unsyncedSince: firstUnsynced.loggedAt };
    }
    return { state: "keep", reason: closed ? "Waiting to sync" : "Chart is open" };
  }
  if (!closed) return { state: "keep", reason: "Chart is open" };
  const confirmedAt = new Date(latest!.payload.confirmedAt);
  const deleteAfter = new Date(confirmedAt.getTime() + DELETE_AFTER_CONFIRM_MS);
  if (now.getTime() >= deleteAfter.getTime()) return { state: "deletable", reason: "Closed, confirmed by the server, and 12 hours have passed" };
  return { state: "keep", reason: "Synced; kept on the phone for 12 hours after confirmation", deleteAfter: deleteAfter.toISOString() };
}
