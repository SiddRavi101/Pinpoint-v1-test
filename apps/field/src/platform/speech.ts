/**
 * Voice input. Offline-only is enforced here (HAZ-05). Engines, best first:
 * 1. On-device Whisper (whisper.ts): runs from model files on this phone,
 *    bundled with the app or downloaded once (model only). Audio is held in
 *    memory and never saved or sent.
 * 2. Native fallback: the phone's on-device engine via the Capgo plugin,
 *    always with useOnDeviceRecognition. If the device can't transcribe
 *    on-device for the locale, voice is switched off and tap charting is used.
 * 3. Browser fallback: no speech; the person types instead.
 *
 * WEEK-0 CHECK: confirm with a network monitor (signal on) that neither
 * engine sends audio anywhere. The Capgo plugin's README describes a legacy
 * fallback path; if that path can go to the network, fork the plugin.
 */
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { DRUGS, type Utterance } from "@pinpoint/core";
import { store } from "./storage";
import { WhisperSpeech, locateModel, micSupported, whisperRuntime, type LoadProgress, type ModelLocation } from "./whisper";
import { DEFAULT_MODEL, WHISPER_MODELS, modelById, type WhisperModel } from "./whisper-util";

export { WHISPER_MODELS, type WhisperModel, type ModelLocation, type LoadProgress };

export type VoiceStatus =
  | { kind: "ready" }
  | { kind: "unavailable"; reason: string }
  | { kind: "dev"; reason: string };

export interface SpeechEngine {
  status(): Promise<VoiceStatus>;
  /** Short name stamped on every utterance, e.g. "phone-on-device". */
  readonly id: string;
  /** Start listening; `onPartial` gets live text. */
  start(onPartial: (text: string) => void): Promise<void>;
  /** Stop and return what was heard (text and times only), or null if nothing. */
  stop(): Promise<Utterance | null>;
}

const LANGUAGE = "en-US";

/** Words the recognizer should favor: drug names and charting terms. */
const CONTEXT = [
  ...DRUGS.flatMap((d) => [d.name, ...d.aliases]),
  "tourniquet", "GCS", "SpO2", "sats", "resps", "BP", "NKDA", "milligrams", "micrograms", "palp",
];

class NativeSpeech implements SpeechEngine {
  readonly id = "phone-on-device";
  private last = "";
  private startedAt = new Date();
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
    this.startedAt = new Date();
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

  async stop(): Promise<Utterance | null> {
    try {
      await SpeechRecognition.stop();
      const last = await SpeechRecognition.getLastPartialResult().catch(() => null);
      const text = (last as { text?: string } | null)?.text;
      if (text) this.last = text;
    } finally {
      await this.handle?.remove();
      this.handle = undefined;
    }
    const text = this.last.trim();
    return text ? { text, startedAt: this.startedAt.toISOString(), endedAt: new Date().toISOString(), engine: this.id } : null;
  }
}

class DevSpeech implements SpeechEngine {
  readonly id = "typed";
  constructor(private readonly reason = "Browser preview: type what you would say. For voice, download the offline voice model in Settings.") {}
  async status(): Promise<VoiceStatus> {
    return { kind: "dev", reason: this.reason };
  }
  async start(): Promise<void> {}
  async stop(): Promise<Utterance | null> {
    return null;
  }
}

class WhisperEngine implements SpeechEngine {
  readonly id: string;
  constructor(private readonly w: WhisperSpeech) {
    this.id = w.id;
  }
  async status(): Promise<VoiceStatus> {
    await this.w.ready();
    return { kind: "ready" };
  }
  start(onPartial: (text: string) => void) {
    return this.w.start(onPartial);
  }
  stop() {
    return this.w.stop();
  }
}

// ---- Engine selection -------------------------------------------------------

export type EngineKind = "whisper" | "phone" | "typed";

export interface VoiceInfo {
  kind: EngineKind;
  /** Name stamped on utterances. */
  engineId: string;
  model: WhisperModel;
  modelLocation: ModelLocation;
  native: boolean;
  micSupported: boolean;
  /** Why Whisper isn't in use, when it isn't. */
  note?: string;
}

const VOICE_MODEL_SETTING = "voiceModel";

export async function getVoiceModel(): Promise<WhisperModel> {
  try {
    return modelById(await store.getSetting(VOICE_MODEL_SETTING));
  } catch {
    return DEFAULT_MODEL;
  }
}

export async function setVoiceModel(id: WhisperModel["id"]): Promise<void> {
  await store.setSetting(VOICE_MODEL_SETTING, id);
  resetVoice();
}

let selected: Promise<{ engine: SpeechEngine; info: VoiceInfo }> | null = null;

async function select(): Promise<{ engine: SpeechEngine; info: VoiceInfo }> {
  const native = Capacitor.isNativePlatform();
  const model = await getVoiceModel();
  const mic = micSupported();
  const location = mic ? await locateModel(model) : "missing";
  const fallback = (note?: string) => {
    const engine: SpeechEngine = native ? new NativeSpeech() : new DevSpeech();
    return { engine, info: { kind: (native ? "phone" : "typed") as EngineKind, engineId: engine.id, model, modelLocation: location, native, micSupported: mic, note } };
  };
  if (!mic) return fallback("This device can't record in the app.");
  if (location === "missing") return fallback("The offline voice model isn't on this device.");
  const w = new WhisperSpeech(model, location === "bundled" ? "bundled" : "remote");
  try {
    await w.ready();
  } catch (e) {
    return fallback(`The offline voice model could not load: ${(e as Error).message}`);
  }
  return { engine: new WhisperEngine(w), info: { kind: "whisper", engineId: w.id, model, modelLocation: location, native, micSupported: mic } };
}

const current = () => (selected ??= select());

/** Pick the engine again (after a download or a model change). */
export function resetVoice(): void {
  selected = null;
}

/** Which engine is in use and where the model is, for Setup. */
export async function voiceInfo(): Promise<VoiceInfo> {
  return (await current()).info;
}

/**
 * One-time download of the voice model (model files only, from the model
 * hub) into this browser's storage. After this, voice works offline.
 */
export async function downloadVoiceModel(model: WhisperModel, onProgress?: (p: LoadProgress) => void): Promise<void> {
  await whisperRuntime.load(model, "remote", onProgress);
  resetVoice();
}

/** The engine the chart screen uses. Chosen on first use. */
export const speech: SpeechEngine = {
  get id() {
    return "auto";
  },
  async status() {
    const { engine } = await current();
    return engine.status();
  },
  async start(onPartial) {
    return (await current()).engine.start(onPartial);
  },
  async stop() {
    return (await current()).engine.stop();
  },
};
