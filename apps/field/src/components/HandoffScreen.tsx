import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { buildHandoff, projectChart, type ChartLog } from "@pinpoint/core";
import { setKeepAwake, speak, stopSpeaking } from "../platform/device";

/** One-page MIST handoff: read it, say it, or show the QR. */
export function HandoffScreen({ log, onBack }: { log: ChartLog; onBack: () => void }) {
  const chart = projectChart(log.events);
  const h = buildHandoff(chart, new Date());
  const [qr, setQr] = useState<string>("");
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(h.qrText, { errorCorrectionLevel: "M", margin: 2, width: 512 }).then(setQr, () => setQr(""));
  }, [h.qrText]);

  useEffect(() => {
    void setKeepAwake(true);
    return () => {
      void setKeepAwake(false);
      void stopSpeaking();
    };
  }, []);

  return (
    <div className="screen handoff">
      <header className="bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back</button>
        <div className="bar-title"><strong>Handoff</strong></div>
        <button type="button" className="btn" onClick={() => void speak(h.speech)}>Read aloud</button>
      </header>
      {h.training && <p className="training-banner">TRAINING — NOT A REAL PATIENT</p>}
      {h.sections.map((s) => (
        <section key={s.key} className="mist">
          <h2><span className="mist-key">{s.key}</span> {s.title}</h2>
          {s.lines.length === 0 ? <p className="muted">Nothing recorded</p> : <ul>{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </section>
      ))}
      <button type="button" className="btn primary wide" onClick={() => setShowQr((v) => !v)}>{showQr ? "Hide QR" : "Show QR"}</button>
      {showQr && qr && (
        <figure className="qr">
          <img src={qr} alt="Handoff QR code, plain text" />
          <figcaption className="muted small">{h.qrText.length} of 350 characters. Any phone camera can read it as plain text.</figcaption>
        </figure>
      )}
    </div>
  );
}
