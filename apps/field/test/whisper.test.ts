import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  SAMPLE_RATE,
  cleanTranscript,
  concatFloat32,
  isSilent,
  looksLikeWhisperConfig,
  modelById,
  resampleLinear,
  toSegments,
} from "../src/platform/whisper-util";

const tone = (seconds: number, rate = SAMPLE_RATE, amp = 0.2) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / rate));

describe("whisper audio helpers (REQ-002: audio stays in memory)", () => {
  it("joins mic chunks in order", () => {
    expect(Array.from(concatFloat32([new Float32Array([1, 2]), new Float32Array([3])]))).toEqual([1, 2, 3]);
  });

  it("resamples 48 kHz to 16 kHz", () => {
    const out = resampleLinear(tone(1, 48_000), 48_000);
    expect(out.length).toBe(16_000);
    expect(resampleLinear(tone(1), SAMPLE_RATE).length).toBe(16_000);
  });

  it("treats silence and very short clips as nothing said", () => {
    expect(isSilent(new Float32Array(SAMPLE_RATE * 2))).toBe(true);
    expect(isSilent(tone(0.1))).toBe(true);
    expect(isSilent(tone(1))).toBe(false);
  });
});

describe("whisper transcript cleanup", () => {
  it("drops non-speech markers", () => {
    expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscript("Pulse 112. (wind blowing) BP 130 over 85.")).toBe("Pulse 112. BP 130 over 85.");
    expect(cleanTranscript("Patient reports (pain) in the leg")).toBe("Patient reports (pain) in the leg");
  });

  it("maps chunks to segments clamped to the clip, filling a missing end", () => {
    const segs = toSegments(
      [
        { timestamp: [0, 2.345], text: " Pulse 112." },
        { timestamp: [2.4, null], text: " BP 130 over 85." },
        { timestamp: [5, 6], text: " [BLANK_AUDIO]" },
      ],
      4.5,
    );
    expect(segs).toEqual([
      { start: 0, end: 2.35, text: "Pulse 112." },
      { start: 2.4, end: 4.5, text: "BP 130 over 85." },
    ]);
    expect(toSegments(undefined, 3)).toEqual([]);
  });
});

describe("whisper model selection", () => {
  it("defaults to base.en and accepts tiny.en", () => {
    expect(modelById(null)).toBe(DEFAULT_MODEL);
    expect(modelById("whisper-tiny.en").repo).toBe("onnx-community/whisper-tiny.en");
    expect(modelById("unknown").id).toBe("whisper-base.en");
  });

  it("recognises a real config, not an HTML fallback page", () => {
    expect(looksLikeWhisperConfig('{"model_type":"whisper"}')).toBe(true);
    expect(looksLikeWhisperConfig("<!doctype html><html></html>")).toBe(false);
  });
});
