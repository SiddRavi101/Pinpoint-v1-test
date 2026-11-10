import { useEffect, useState } from "react";
import { PILOT, DEFAULT_SERVER } from "./config";
import { store } from "./platform/storage";
import { enablePrivacyScreen, onBackground, unlock } from "./platform/device";
import { useCharts } from "./useCharts";
import { Home } from "./components/Home";
import { Setup, type DeviceSettings } from "./components/Setup";
import { ChartScreen } from "./components/ChartScreen";
import { HandoffScreen } from "./components/HandoffScreen";

type View = { name: "home" } | { name: "settings" } | { name: "chart"; id: string } | { name: "handoff"; id: string };

export function App() {
  const [locked, setLocked] = useState(true);
  const [lockMsg, setLockMsg] = useState("");
  const [storeReady, setStoreReady] = useState(false);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [view, setView] = useState<View>({ name: "home" });

  const tryUnlock = async () => {
    const r = await unlock();
    if (r.ok) {
      setLocked(false);
      setLockMsg("");
    } else setLockMsg(r.message ?? "Could not unlock");
  };

  useEffect(() => {
    void enablePrivacyScreen();
    void tryUnlock();
    return onBackground(() => setLocked(true));
  }, []);

  useEffect(() => {
    if (locked || storeReady) return;
    (async () => {
      await store.init();
      const [deviceId, serverUrl, token] = await Promise.all(["deviceId", "serverUrl", "token"].map((k) => store.getSetting(k)));
      if (deviceId && serverUrl && token) setSettings({ deviceId, serverUrl, token });
      setStoreReady(true);
    })();
  }, [locked, storeReady]);

  if (locked) {
    return (
      <div className="screen lock">
        <h1>Pinpoint</h1>
        <p className="muted">Locked. Charts stay encrypted on this phone.</p>
        {lockMsg && <p className="warn">{lockMsg}</p>}
        <button type="button" className="btn primary big" onClick={tryUnlock}>Unlock</button>
      </div>
    );
  }
  if (!storeReady) return <div className="screen"><p className="muted">Opening…</p></div>;
  if (!settings || view.name === "settings") {
    return (
      <Setup
        initial={settings ?? { deviceId: "", serverUrl: DEFAULT_SERVER, token: "" }}
        onCancel={settings ? () => setView({ name: "home" }) : undefined}
        onSave={async (s) => {
          await store.setSetting("deviceId", s.deviceId);
          await store.setSetting("serverUrl", s.serverUrl);
          await store.setSetting("token", s.token);
          setSettings(s);
          setView({ name: "home" });
        }}
      />
    );
  }
  return <Main settings={settings} view={view} setView={setView} />;
}

function Main({ settings, view, setView }: { settings: DeviceSettings; view: View; setView: (v: View) => void }) {
  const charts = useCharts(settings.deviceId);
  if (!charts.ready) return <div className="screen"><p className="muted">Loading charts…</p></div>;
  const log = view.name === "chart" || view.name === "handoff" ? charts.logs.find((l) => l.chartId === view.id) : undefined;
  const training = log ? log.events[0]?.kind === "chart_opened" && log.events[0].payload.training : PILOT;

  let body;
  if (view.name === "chart" && log) {
    body = <ChartScreen log={log} commit={(fn) => charts.commit(log.chartId, fn as never)} onHandoff={() => setView({ name: "handoff", id: log.chartId })} onBack={() => setView({ name: "home" })} />;
  } else if (view.name === "handoff" && log) {
    body = <HandoffScreen log={log} onBack={() => setView({ name: "chart", id: log.chartId })} />;
  } else {
    body = (
      <Home
        logs={charts.logs}
        onOpen={(id) => setView({ name: "chart", id })}
        onNew={async () => {
          const l = await charts.open(PILOT);
          setView({ name: "chart", id: l.chartId });
        }}
        onSettings={() => setView({ name: "settings" })}
        onSync={async () => {
          const r = await charts.syncAll(settings);
          if (r.errors.length) return `Could not sync: ${r.errors[0]}`;
          return `Synced ${r.synced} chart${r.synced === 1 ? "" : "s"}${r.deleted ? `, removed ${r.deleted} from this phone` : ""}.`;
        }}
      />
    );
  }
  return (
    <div className={training ? "training" : undefined}>
      {training && <div className="watermark" aria-hidden="true">TRAINING</div>}
      {body}
    </div>
  );
}
