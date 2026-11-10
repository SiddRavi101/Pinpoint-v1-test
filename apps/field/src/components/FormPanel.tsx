import type { Chart, Proposal } from "@pinpoint/core";

/** Live paper-form view of the chart. Replaced by the form layout view once wired. */
export function FormPanel({ chart }: { chart: Chart; cards: Proposal[] }) {
  return <p className="muted">Form view for chart {chart.id.slice(0, 6)}: coming in this build.</p>;
}
