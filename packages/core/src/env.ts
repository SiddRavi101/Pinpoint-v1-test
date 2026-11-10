/** Injectable clock and id generator so logic stays deterministic under test. */
export interface Env {
  now: () => Date;
  newId: () => string;
}

export const defaultEnv: Env = {
  now: () => new Date(),
  newId: () => globalThis.crypto.randomUUID(),
};

/** Counter-based ids and a settable clock for tests and fixtures. */
export function testEnv(start = "2026-12-16T19:00:00.000Z"): Env & { advance: (ms: number) => void; set: (iso: string) => void } {
  let t = new Date(start).getTime();
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `id-${++n}`,
    advance: (ms) => {
      t += ms;
    },
    set: (iso) => {
      t = new Date(iso).getTime();
    },
  };
}
