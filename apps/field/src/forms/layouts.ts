/**
 * Saved paper-form layouts. Kept in the protected store (settings table),
 * never in localStorage. A layout is a blank form: labels and bindings only.
 */
import { BUILTIN_LAYOUT, isFormLayout, type FormLayout } from "@pinpoint/core";
import { store } from "../platform/storage";

const LAYOUTS_KEY = "formLayouts";
const ACTIVE_KEY = "activeFormLayout";

/** Scanned layouts saved on this device (the built-in one is not stored). */
export async function loadLayouts(): Promise<FormLayout[]> {
  const raw = await store.getSetting(LAYOUTS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isFormLayout) : [];
  } catch {
    return [];
  }
}

/** Every layout the medic can pick, built-in first. */
export async function allLayouts(): Promise<FormLayout[]> {
  return [BUILTIN_LAYOUT, ...(await loadLayouts())];
}

/** Add or replace (same id) a scanned layout. */
export async function saveLayout(layout: FormLayout): Promise<void> {
  if (layout.source === "builtin") return;
  const list = (await loadLayouts()).filter((l) => l.id !== layout.id);
  await store.setSetting(LAYOUTS_KEY, JSON.stringify([...list, layout]));
}

export async function deleteLayout(id: string): Promise<void> {
  await store.setSetting(LAYOUTS_KEY, JSON.stringify((await loadLayouts()).filter((l) => l.id !== id)));
  if ((await store.getSetting(ACTIVE_KEY)) === id) await store.setSetting(ACTIVE_KEY, BUILTIN_LAYOUT.id);
}

/** The layout the document view uses. Falls back to the built-in layout. */
export async function activeLayout(): Promise<FormLayout> {
  const id = await store.getSetting(ACTIVE_KEY);
  if (!id || id === BUILTIN_LAYOUT.id) return BUILTIN_LAYOUT;
  return (await loadLayouts()).find((l) => l.id === id) ?? BUILTIN_LAYOUT;
}

export async function setActiveLayout(id: string): Promise<void> {
  await store.setSetting(ACTIVE_KEY, id);
}
