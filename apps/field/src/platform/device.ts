/**
 * Thin wrappers over native features, each safe to call in the browser preview.
 * - App lock: Face ID / fingerprint, with the device passcode as the PIN backup.
 * - Privacy screen: blanks the app-switcher snapshot (HAZ-07).
 * - Keep awake: holds the screen on while a tourniquet timer runs (HAZ-08).
 * - Read-aloud: on-device text to speech.
 */
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { PrivacyScreen } from "@capacitor-community/privacy-screen";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

export const isNative = Capacitor.isNativePlatform();

export async function unlock(): Promise<{ ok: boolean; message?: string }> {
  if (!isNative) return { ok: true, message: "Browser preview: app lock is skipped" };
  try {
    const avail = await NativeBiometric.isAvailable({ useFallback: true });
    if (!avail.isAvailable) return { ok: false, message: "Set a passcode and Face ID or fingerprint on this phone to use Pinpoint." };
    await NativeBiometric.verifyIdentity({ reason: "Unlock Pinpoint", title: "Unlock Pinpoint", useFallback: true, fallbackTitle: "Use passcode" });
    return { ok: true };
  } catch {
    return { ok: false, message: "Not unlocked. Try again." };
  }
}

/** Calls `onLock` whenever the app goes to the background, so it relocks on return. */
export function onBackground(onLock: () => void): () => void {
  if (!isNative) return () => {};
  const h = App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) onLock();
  });
  return () => void h.then((x) => x.remove());
}

export async function enablePrivacyScreen() {
  if (isNative) await PrivacyScreen.enable().catch(() => {});
}

export async function setKeepAwake(on: boolean) {
  if (isNative) await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
}

export async function speak(text: string) {
  if (isNative) {
    await TextToSpeech.speak({ text, lang: "en-US", rate: 0.95 });
    return;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}

export async function stopSpeaking() {
  if (isNative) await TextToSpeech.stop().catch(() => {});
  else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
