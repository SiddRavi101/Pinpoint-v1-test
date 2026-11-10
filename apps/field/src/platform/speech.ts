/**
 * Voice input. Offline-only is enforced here (HAZ-05):
 * - Native: the phone's on-device engine via the Capgo plugin, always with
 *   useOnDeviceRecognition. If the device can't transcribe on-device for
 *   the locale, voice is switched off and tap charting is used.
 * - Browser (dev only): no speech at all; the developer types instead.
 * Audio is never saved or sent: the plugin returns text only, in memory.
 *
 * WEEK-0 CHECK: confirm with a network monitor (signal on) that the plugin
 * never falls back to a cloud recognizer. Its README describes a legacy
 * fallback path; if that path can go to the network, fork the plugin.
 */
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { DRUGS } from "@pinpoint/core";

export type VoiceStatus =
  | { kind: "ready" }
  | { kind: "unavailable"; reason: string }
  | { kind: "dev"; reason: string };

export interface SpeechEngine {
  status(): Promise<VoiceStatus>;
  /** Start listening; `onPartial` gets live text. */
  start(onPartial: (text: string) => void): Promise<void>;
  /** Stop and return the final text. */
  stop(): Promise<string>;
}

const LANGUAGE = "en-US";

/** Words the recognizer should favor: drug names and charting terms. */
const CONTEXT = [
  ...DRUGS.flatMap((d) => [d.name, ...d.aliases]),
  "tourniquet", "GCS", "SpO2", "sats", "resps", "BP", "NKDA", "milligrams", "micrograms", "palp",
];

class NativeSpeech implements SpeechEngine {
  private last = "";
  private handle?: PluginListenerHandle;

  async status(): Promise<VoiceStatus> {
    try {
      const perm = await SpeechRecognition.requestPermissions();
      if (perm.speechRecognition !== "granted") return { kind: "unavailable", reason: "Microphone or speech permission was not granted" };
      const { available } = await SpeechRecognition.isOnDeviceRecognitionAvailable({ language: LANGUAGE });
      if (!available) return { kind: "unavailable", reason: "This phone can't transcribe on the device for English. Use tap charting, or download the offline language at setup." };
      return { kind: "ready" };
    } catch (e) {
      return { kind: "unavailable", reason: `Voice could not start: ${(e as Error).message}` };
    }
  }

  async start(onPartial: (text: string) => void): Promise<void> {
    this.last = "";
    await this.handle?.remove();
    this.handle = await SpeechRecognition.addListener("partialResults", (ev) => {
      const text = ev.accumulatedText ?? ev.matches?.[0] ?? "";
      if (text) {
        this.last = text;
        onPartial(text);
      }
    });
    await SpeechRecognition.start({
      language: LANGUAGE,
      partialResults: true,
      popup: false,
      useOnDeviceRecognition: true, // never cloud: rejects if on-device is unavailable
      contextualStrings: CONTEXT,
      addPunctuation: true,
    });
  }

  async stop(): Promise<string> {
    try {
      await SpeechRecognition.stop();
      const last = await SpeechRecognition.getLastPartialResult().catch(() => null);
      const text = (last as { text?: string } | null)?.text;
      if (text) this.last = text;
    } finally {
      await this.handle?.remove();
      this.handle = undefined;
    }
    return this.last;
  }
}

class DevSpeech implements SpeechEngine {
  async status(): Promise<VoiceStatus> {
    return { kind: "dev", reason: "Browser preview: type what you would say. Real voice runs only in the native app." };
  }
  async start(): Promise<void> {}
  async stop(): Promise<string> {
    return "";
  }
}

export const speech: SpeechEngine = Capacitor.isNativePlatform() ? new NativeSpeech() : new DevSpeech();
