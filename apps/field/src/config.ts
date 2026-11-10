/**
 * Build-time settings (Vite env):
 *   VITE_PILOT=true          every chart is a TRAINING chart (mock patients only)
 *   VITE_BUILD_EXPIRES=ISO   after this time the app will not open new charts
 *   VITE_DEFAULT_SERVER=URL  prefilled server address on the setup screen
 */
export const PILOT = (import.meta.env.VITE_PILOT ?? "true") !== "false";
export const BUILD_EXPIRES: string | undefined = import.meta.env.VITE_BUILD_EXPIRES || undefined;
export const DEFAULT_SERVER: string = import.meta.env.VITE_DEFAULT_SERVER ?? "http://localhost:8787";

export function buildExpired(now = new Date()): boolean {
  return BUILD_EXPIRES !== undefined && now.getTime() > new Date(BUILD_EXPIRES).getTime();
}
