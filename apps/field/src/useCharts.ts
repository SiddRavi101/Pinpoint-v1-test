/**
 * Chart state for the app. Every event is written to the protected store as
 * soon as it is appended, so a dead phone loses at most the current card.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChartLog, type ChartEvent } from "@pinpoint/core";
import { store } from "./platform/storage";
import { deletableCharts, uploadChart, type SyncConfig } from "./sync";

export interface ChartsApi {
  ready: boolean;
  logs: ChartLog[];
  version: number;
  open(training: boolean): Promise<ChartLog>;
  commit(chartId: string, fn: (log: ChartLog) => ChartEvent | ChartEvent[] | void): Promise<void>;
  syncAll(cfg: SyncConfig): Promise<{ synced: number; deleted: number; errors: string[] }>;
}

export function useCharts(deviceId: string | null): ChartsApi {
  const logsRef = useRef(new Map<string, ChartLog>());
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  useEffect(() => {
    let alive = true;
    (async () => {
      const events = await store.allEvents();
      const byChart = new Map<string, ChartEvent[]>();
      for (const e of events) (byChart.get(e.chartId) ?? byChart.set(e.chartId, []).get(e.chartId)!).push(e);
      for (const [id, evs] of byChart) logsRef.current.set(id, ChartLog.fromEvents(evs));
      // Apply the deletion rule on every start.
      for (const id of deletableCharts([...logsRef.current.values()], new Date())) {
        await store.deleteChart(id);
        logsRef.current.delete(id);
      }
      if (alive) {
        setReady(true);
        bump();
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = async (events: ChartEvent[]) => {
    for (const e of events) await store.append(e);
  };

  const open = useCallback(
    async (training: boolean) => {
      if (!deviceId) throw new Error("Set up this device first");
      const log = ChartLog.open({ deviceId, training });
      await persist([...log.events]);
      logsRef.current.set(log.chartId, log);
      bump();
      return log;
    },
    [deviceId],
  );

  const commit = useCallback(async (chartId: string, fn: (log: ChartLog) => ChartEvent | ChartEvent[] | void) => {
    const log = logsRef.current.get(chartId);
    if (!log) throw new Error("Chart not found");
    const before = log.events.length;
    fn(log);
    await persist(log.events.slice(before));
    bump();
  }, []);

  const syncAll = useCallback(async (cfg: SyncConfig) => {
    let synced = 0;
    const errors: string[] = [];
    for (const log of logsRef.current.values()) {
      try {
        const receipt = await uploadChart(log, cfg);
        if (receipt) {
          await persist([receipt]);
          synced++;
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    let deleted = 0;
    for (const id of deletableCharts([...logsRef.current.values()], new Date())) {
      await store.deleteChart(id);
      logsRef.current.delete(id);
      deleted++;
    }
    bump();
    return { synced, deleted, errors };
  }, []);

  return { ready, logs: [...logsRef.current.values()], version, open, commit, syncAll };
}
