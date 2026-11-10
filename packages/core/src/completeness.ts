/**
 * Three completeness flags for the medical director's review list.
 * They point at missing documentation; they never comment on care.
 * PENDING: Dr. Lang to confirm which three flags matter most.
 */
import type { Chart } from "./chart.js";

export interface Flag {
  code: "no_vitals" | "med_incomplete" | "tourniquet_incomplete";
  message: string;
}

export function completenessFlags(chart: Chart): Flag[] {
  const flags: Flag[] = [];
  if (chart.vitals.length === 0) flags.push({ code: "no_vitals", message: "No vital signs recorded" });
  const incompleteMeds = chart.meds.filter((m) => !m.value.drug || !m.value.dose || !m.value.route);
  if (incompleteMeds.length) {
    flags.push({ code: "med_incomplete", message: `${incompleteMeds.length} medication entr${incompleteMeds.length === 1 ? "y is" : "ies are"} missing a name, dose or route` });
  }
  const tq = chart.tourniquets.filter((t) => !t.limb || !t.onAt);
  if (tq.length) flags.push({ code: "tourniquet_incomplete", message: `${tq.length} tourniquet entr${tq.length === 1 ? "y is" : "ies are"} missing a limb or on time` });
  return flags;
}
