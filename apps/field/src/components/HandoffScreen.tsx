import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QR_MAX_CHARS, buildHandoff, encodeTransfer, projectChart, type ChartLog } from "@pinpoint/core";
import { setKeepAwake, speak, stopSpeaking } from "../platform/device";
import { browserCodec } from "../platform/qrscan";
import "../handoff.css";

type Mode = "text" | "full";
const FRAME_MS = 280; // about 3.5 frames per second

/**
 * One-page MIST handoff: read it, say it, or show a QR.
 * - "For any camera": plain text (≤ 350 characters), readable offline by any phone camera.
 * - "To another Pinpoint": the full chart as an animated QR, scanned in Pinpoint's Receive screen.
 * Nothing is copied to the clipboard or put in a URL (REQ-052).
 */
export function HandoffScreen({ log, onBack }: { log: ChartLog; onBack: () => void }) {
  const chart = projectChart(log.events);
  const h = buildHandoff(chart, new Date());
  const [mode, setMode] = useState<Mode>("text");
  const [textQr, setTextQr] = useState("");
  const [frames, setFrames] = useState<string[]>([]);
  const [frameErr, setFrameErr] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const eventCount = log.events.length;

  useEffect(() => {
    QRCode.toDataURL(h.qrText, { errorCorrectionLevel: "M", margin: 4, width: 640, color: { dark: "#000000", light: "#ffffff" } }).then(setTextQr, () => setTextQr(""));
  }, [h.qrText]);

  useEffect(() => {
    if (mode !== "full") return;
    let alive = true;
    setFrameErr("");
    (async () => {
      try {
        const t = await encodeTransfer(log.events, { codec: browserCodec });
        const urls = await Promise.all(
          t.frames.map((f) => QRCode.toDataURL(f, { errorCorrectionLevel: "L", margin: 4, width: 640, color: { dark: "#000000", light: "#ffffff" } })),
        );
        if (alive) {
          setFrames(urls);
          setFrame(0);
        }
      } catch (e) {
        if (alive) setFrameErr(`Could not build the transfer: ${(e as Error).message}`);
      }
    })();
    return () => {
      alive = false;
    };
    // Rebuild only when the log grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, eventCount]);

  useEffect(() => {
    if (mode !== "full" || !playing || frames.length < 2) return;
    const t = setInterval(() => setFrame((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(t);
  }, [mode, playing, frames.length]);

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

      <h2>Scan to receive</h2>
      <div className="ho-tabs" role="tablist" aria-label="Who is receiving">
        <button type="button" role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")}>Any phone camera</button>
        <button type="button" role="tab" aria-selected={mode === "full"} onClick={() => setMode("full")}>Another Pinpoint</button>
      </div>

      {mode === "text" && (
        <>
          {textQr && (
            <figure className="ho-qr">
              <img src={textQr} alt="Handoff QR code, plain text summary" />
              <figcaption>Plain-text summary, {h.qrText.length} of {QR_MAX_CHARS} characters. Works with no signal.</figcaption>
            </figure>
          )}
          <p className="ho-note">
            Turn your screen brightness up. On an iPhone the camera may offer “Search the web” for this code. <strong>Don't tap that</strong>: it would send the text off the phone. If their camera only offers a search, read the summary above out loud instead.
          </p>
        </>
      )}

      {mode === "full" && (
        <>
          {frameErr && <p className="warn">{frameErr}</p>}
          {!frameErr && frames.length === 0 && <p className="muted">Preparing…</p>}
          {frames.length > 0 && (
            <figure className="ho-qr">
              <img src={frames[frame]} alt={`Full chart transfer, frame ${frame + 1} of ${frames.length}`} />
              <figcaption>
                <span className="ho-counter">Frame {frame + 1} of {frames.length}</span>
                <br />
                Whole chart, including the transcript. Hold steady until the other phone says “Received”.
              </figcaption>
              {frames.length > 1 && (
                <div className="ho-controls">
                  <button type="button" className="btn" onClick={() => { setPlaying(false); setFrame((i) => (i - 1 + frames.length) % frames.length); }}>Previous</button>
                  <button type="button" className="btn primary" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
                  <button type="button" className="btn" onClick={() => { setPlaying(false); setFrame((i) => (i + 1) % frames.length); }}>Next</button>
                </div>
              )}
            </figure>
          )}
          <ol className="ho-steps">
            <li>On the other phone, open Pinpoint and tap <strong>Receive</strong>.</li>
            <li>Point it at this code. Frames can be read in any order, and missed ones come round again.</li>
            <li>The received chart is read-only on that phone.</li>
          </ol>
        </>
      )}
    </div>
  );
}
