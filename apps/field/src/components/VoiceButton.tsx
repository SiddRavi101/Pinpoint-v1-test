import { useEffect, useRef, useState } from "react";
import type { Utterance } from "@pinpoint/core";
import { speech, type VoiceStatus } from "../platform/speech";

/**
 * One big glove-friendly button. Hold to talk, or tap once to start and
 * again to stop. A red bar shows whenever the mic is on.
 */
export function VoiceButton({ onUtterance }: { onUtterance: (u: Utterance) => void }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState("");
  const [typed, setTyped] = useState("");
  const pressedAt = useRef(0);
  const toggleMode = useRef(false);

  useEffect(() => {
    speech.status().then(setStatus);
  }, []);

  const start = async () => {
    setLive("");
    setListening(true);
    try {
      await speech.start(setLive);
    } catch (e) {
      setListening(false);
      setStatus({ kind: "unavailable", reason: (e as Error).message });
    }
  };
  const stop = async () => {
    const heard = await speech.stop();
    setListening(false);
    setLive("");
    if (heard?.text.trim()) onUtterance(heard);
  };

  if (!status) return <div className="voice-wrap"><p className="muted">Checking voice…</p></div>;

  if (status.kind === "dev") {
    return (
      <form
        className="voice-wrap dev"
        onSubmit={(e) => {
          e.preventDefault();
          const at = new Date().toISOString();
          if (typed.trim()) onUtterance({ text: typed.trim(), startedAt: at, endedAt: at, engine: "typed" });
          setTyped("");
        }}
      >
        <label htmlFor="dev-utterance" className="muted small">{status.reason}</label>
        <div className="row">
          <input id="dev-utterance" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="pulse 112, BP 130 over 85" autoComplete="off" />
          <button type="submit" className="btn primary">Say</button>
        </div>
      </form>
    );
  }

  if (status.kind === "unavailable") {
    return (
      <div className="voice-wrap">
        <p className="warn">Voice is off: {status.reason}</p>
      </div>
    );
  }

  return (
    <div className="voice-wrap">
      {listening && <div className="mic-bar" role="status">Mic on</div>}
      {listening && <p className="live" aria-live="polite">{live || "Listening…"}</p>}
      <button
        type="button"
        className={`voice-btn${listening ? " on" : ""}`}
        onPointerDown={() => {
          pressedAt.current = Date.now();
          if (!listening) {
            toggleMode.current = false;
            void start();
          }
        }}
        onPointerUp={() => {
          const held = Date.now() - pressedAt.current;
          if (listening && toggleMode.current) {
            toggleMode.current = false;
            void stop();
          } else if (held < 350) {
            toggleMode.current = true; // short tap: keep listening until the next tap
          } else {
            void stop();
          }
        }}
        aria-pressed={listening}
      >
        {listening ? "Release or tap to finish" : "Hold to talk"}
      </button>
    </div>
  );
}
