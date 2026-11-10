import { useEffect, useState } from "react";
import {
  WHISPER_MODELS,
  downloadVoiceModel,
  resetVoice,
  setVoiceModel,
  voiceInfo,
  type VoiceInfo,
  type WhisperModel,
} from "../platform/speech";
import "../voice.css";

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
      <VoiceSetup />
    </div>
  );
}

const ENGINE_LABEL: Record<VoiceInfo["kind"], string> = {
  whisper: "Offline voice model (Whisper) on this device",
  phone: "The phone's own on-device speech engine",
  typed: "No voice: typed input",
};

/** Which speech engine is in use, and the one-time model download. */
function VoiceSetup() {
  const [info, setInfo] = useState<VoiceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");

  const refresh = () => {
    setInfo(null);
    voiceInfo().then(setInfo, (e) => setMsg((e as Error).message));
  };
  useEffect(refresh, []);

  if (!info) return <section className="voice-setup" aria-label="Voice"><h2>Voice</h2><p className="muted">Checking voice…</p></section>;

  const download = async (model: WhisperModel) => {
    setBusy(true);
    setMsg("");
    setProgress(0);
    try {
      await downloadVoiceModel(model, (p) => setProgress(p.fraction));
      setMsg("Voice model saved on this device. Voice now works offline.");
      refresh();
    } catch (e) {
      setMsg(`Download failed: ${(e as Error).message}. Check the connection and try again.`);
      resetVoice();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="voice-setup" aria-label="Voice">
      <h2>Voice</h2>
      <p className={`voice-status${info.kind === "whisper" ? " ok" : ""}`}>{ENGINE_LABEL[info.kind]}</p>
      {info.kind === "whisper" && (
        <p className="muted small">
          {info.model.label}. {info.modelLocation === "bundled" ? "Included with this app build." : "Downloaded to this device."} Speech is turned
          into text on this phone. Audio is never saved or sent.
        </p>
      )}
      {info.note && info.kind !== "whisper" && <p className="muted small">{info.note}</p>}

      <label className="field" htmlFor="set-voice-model">
        <span>Voice model</span>
        <select
          id="set-voice-model"
          value={info.model.id}
          disabled={busy}
          onChange={async (e) => {
            await setVoiceModel(e.target.value as WhisperModel["id"]);
            refresh();
          }}
        >
          {WHISPER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label} · about {m.approxMb} MB</option>
          ))}
        </select>
      </label>

      {info.modelLocation === "missing" && info.micSupported && (
        <>
          <p className="small">
            Download the voice model once (about {info.model.approxMb} MB) while you have signal. Only the model is downloaded. After that, voice
            works with no signal, and audio never leaves this phone.
          </p>
          <button type="button" className="btn primary wide" disabled={busy} onClick={() => void download(info.model)}>
            {busy ? "Downloading…" : "Download offline voice model"}
          </button>
          {busy && (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </>
      )}
      {msg && <p className="muted small" role="status">{msg}</p>}
      <p className="muted small">In development. Tested on mock patients only. Every voice entry still needs a tap to confirm.</p>
    </section>
  );
}
