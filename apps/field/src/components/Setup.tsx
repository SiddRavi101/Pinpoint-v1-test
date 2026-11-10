import { useState } from "react";

export interface DeviceSettings {
  deviceId: string;
  serverUrl: string;
  token: string;
}

/** Device enrolment: the team lead gives each phone an ID and a token. */
export function Setup(props: { initial: DeviceSettings; onSave: (s: DeviceSettings) => void; onCancel?: () => void }) {
  const [s, setS] = useState(props.initial);
  const [error, setError] = useState("");
  const set = (k: keyof DeviceSettings) => (e: { target: { value: string } }) => setS((x) => ({ ...x, [k]: e.target.value.trim() }));
  return (
    <div className="screen">
      <header className="bar"><div className="bar-title"><strong>Set up this phone</strong></div></header>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[a-z0-9-]{2,40}$/i.test(s.deviceId)) return setError("Device ID: 2–40 letters, numbers or dashes.");
          if (!/^https?:\/\//.test(s.serverUrl)) return setError("Server address must start with https:// (http:// only for local testing).");
          if (s.token.length < 8) return setError("Paste the device token from your team lead.");
          props.onSave(s);
        }}
      >
        <label className="field" htmlFor="set-device"><span>Device ID</span><input id="set-device" value={s.deviceId} onChange={set("deviceId")} autoComplete="off" /></label>
        <label className="field" htmlFor="set-server"><span>Sync server</span><input id="set-server" value={s.serverUrl} onChange={set("serverUrl")} autoComplete="off" inputMode="url" /></label>
        <label className="field" htmlFor="set-token"><span>Device token</span><input id="set-token" type="password" value={s.token} onChange={set("token")} autoComplete="off" /></label>
        {error && <p className="warn">{error}</p>}
        <div className="row">
          <button type="submit" className="btn primary big">Save</button>
          {props.onCancel && <button type="button" className="btn ghost" onClick={props.onCancel}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
