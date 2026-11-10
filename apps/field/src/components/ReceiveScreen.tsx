import { useEffect, useRef, useState } from "react";
import { TransferReceiver, isTransferFrame, type ChartEvent } from "@pinpoint/core";
import { browserCodec, startQrScanner, type Scanner } from "../platform/qrscan";
import "../handoff.css";

/**
 * Scan another phone's handoff QR, with no network.
 * - Animated full-chart frames (PPT1:…) are collected in any order; when all
 *   are in, the log is checked and handed to onReceived (read-only there).
 * - A plain-text Pinpoint handoff is shown as text.
 * Camera frames stay in memory and the camera stops when this screen closes.
 */
export function ReceiveScreen({ onBack, onReceived }: { onBack(): void; onReceived(events: ChartEvent[]): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const receiver = useRef(new TransferReceiver({ codec: browserCodec }));
  const finishing = useRef(false);
  const [progress, setProgress] = useState<{ received: number; total: number | null }>({ received: 0, total: null });
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [plainText, setPlainText] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let scanner: Scanner | null = null;
    let alive = true;
    const onText = (text: string) => {
      if (!alive || finishing.current) return;
      if (!isTransferFrame(text)) {
        if (text.includes("PINPOINT HANDOFF")) setPlainText(text);
        else setError("That QR code isn't a Pinpoint handoff.");
        return;
      }
      const p = receiver.current.add(text);
      if (p.status === "error") setError(p.error ?? "Frame not read");
      else if (p.status === "added") setError("");
      setProgress({ received: p.received, total: p.total });
      if (p.done) {
        finishing.current = true;
        receiver.current
          .finish()
          .then((events) => {
            if (alive) onReceived(events);
          })
          .catch((e: Error) => {
            if (!alive) return;
            setError(`Could not open this chart: ${e.message}. Start again.`);
            finishing.current = false;
            receiver.current.reset();
            setProgress({ received: 0, total: null });
          });
      }
    };
    (async () => {
      if (!video.current) return;
      try {
        const s = await startQrScanner(video.current, onText);
        if (alive) scanner = s;
        else s.stop();
      } catch (e) {
        if (alive) setCameraError(`Camera not available: ${(e as Error).message}`);
      }
    })();
    return () => {
      alive = false;
      scanner?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const restart = () => {
    receiver.current.reset();
    finishing.current = false;
    setProgress({ received: 0, total: null });
    setError("");
    setPlainText("");
  };

  const pct = progress.total ? Math.round((progress.received / progress.total) * 100) : 0;

  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back</button>
        <div className="bar-title"><strong>Receive a chart</strong></div>
        <button type="button" className="btn" onClick={restart}>Start again</button>
      </header>
      <p className="muted small">Point the camera at the other phone's handoff QR. No signal needed.</p>
      {cameraError ? (
        <div>
          <p className="warn">{cameraError}</p>
          <button type="button" className="btn wide" onClick={() => { setCameraError(""); setAttempt((a) => a + 1); }}>Try the camera again</button>
        </div>
      ) : (
        <video ref={video} className="rx-video" muted playsInline aria-label="Camera view" />
      )}
      <div>
        <div className="rx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
        <p className="small" aria-live="polite">
          {progress.total ? `${progress.received} of ${progress.total} frames` : "Waiting for a code…"}
          {progress.total !== null && progress.received === progress.total ? " · checking…" : ""}
        </p>
      </div>
      {error && <p className="warn" role="alert">{error}</p>}
      {plainText && (
        <section aria-label="Text handoff">
          <h2>Text handoff</h2>
          <pre className="rx-text">{plainText}</pre>
          <p className="muted small">This is the short summary. For the whole chart, ask them to switch to “Another Pinpoint”.</p>
        </section>
      )}
    </div>
  );
}
