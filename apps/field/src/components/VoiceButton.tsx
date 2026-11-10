import { useEffect, useRef, useState } from "react";
import type { Utterance } from "@pinpoint/core";
import { speech, type VoiceStatus } from "../platform/speech";
import "../voice.css";

type Phase = "idle" | "listening" | "transcribing";

/**
 * One big glove-friendly button. Hold to talk, or tap once to start and
 * again to stop. A red bar shows whenever the mic is on. Between release
 * and the result, "Transcribing…" shows (on-device; nothing is sent).
 */
export function VoiceButton({ onUtterance }: { onUtterance: (u: Utterance) => void }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [phase, setPhaseState] = useState<Phase>("idle");
  // Pointer handlers read the phase from a ref: a quick tap's pointerup fires
  // before React re-renders, so state would still say "idle".
  const phaseRef = useRef<Phase>("idle");
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [live, setLive] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const pressedAt = useRef(0);
  const toggleMode = useRef(false);
  const starting = useRef<Promise<boolean> | null>(null);
  const listening = phase === "listening";

  useEffect(() => {
    let alive = true;
    speech.status().then(
      (s) => alive && setStatus(s),
      (e) => alive && setStatus({ kind: "unavailable", reason: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, []);

  const start = () => {
    setLive("");
    setError("");
    setPhase("listening");
    starting.current = speech.start(setLive).then(
      () => true,
      (e) => {
        setPhase("idle");
        setError(`Voice could not start: ${(e as Error).message}`);
        return false;
      },
    );
  };

  const stop = async () => {
    // A release can come before the mic has finished opening.
    const ok = await (starting.current ?? Promise.resolve(false));
    starting.current = null;
    if (!ok) return;
    setPhase("transcribing");
    try {
      const heard = await speech.stop();
      if (heard?.text.trim()) onUtterance(heard);
      else setError("Nothing heard. Try again, or add by tapping.");
    } catch (e) {
      setError(`Could not transcribe: ${(e as Error).message}`);
    } finally {
      setPhase("idle");
      setLive("");
    }
  };

  if (!status) return <div className="voice-wrap"><p className="muted">Loading offline voice…</p></div>;

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
      {phase === "transcribing" && (
        <p className="live transcribing" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Transcribing on this phone…
        </p>
      )}
      {error && phase === "idle" && <p className="muted small">{error}</p>}
      <button
        type="button"
        className={`voice-btn${listening ? " on" : ""}`}
        disabled={phase === "transcribing"}
        onPointerDown={(e) => {
          // Keep the release on this button even when the live text above it
          // grows and pushes the button down mid-press.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* not supported: the release still usually lands here */
          }
          pressedAt.current = Date.now();
          if (phaseRef.current === "idle") {
            toggleMode.current = false;
            start();
          }
        }}
        onPointerUp={() => {
          if (phaseRef.current !== "listening") return;
          const held = Date.now() - pressedAt.current;
          if (toggleMode.current) {
            toggleMode.current = false;
            void stop();
          } else if (held < 350) {
            toggleMode.current = true; // short tap: keep listening until the next tap
          } else {
            void stop();
          }
        }}
        onPointerCancel={() => {
          // The OS took the touch (call, notification): treat it as a release.
          if (phaseRef.current === "listening") {
            toggleMode.current = false;
            void stop();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-pressed={listening}
      >
        {phase === "transcribing" ? "Transcribing…" : listening ? "Release or tap to finish" : "Hold to talk"}
      </button>
    </div>
  );
}
