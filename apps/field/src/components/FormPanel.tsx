import { useEffect, useState } from "react";
import { BUILTIN_LAYOUT, type Chart, type FormLayout, type Proposal } from "@pinpoint/core";
import { activeLayout } from "../forms/layouts";
import { FormView } from "./FormView";

/** The chart shown as the team's paper form, filling in live as cards arrive and are confirmed. */
export function FormPanel({ chart, cards }: { chart: Chart; cards: Proposal[] }) {
  const [layout, setLayout] = useState<FormLayout>(BUILTIN_LAYOUT);
  useEffect(() => {
    let alive = true;
    activeLayout().then((l) => alive && setLayout(l), () => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="stack">
      <p className="muted small">
        Form: <strong>{layout.name}</strong>
        {layout.reviewStatus === "PENDING MEDICAL REVIEW" ? " · PENDING MEDICAL REVIEW" : ""}. Change it under Paper forms on the home screen.
      </p>
      <FormView chart={chart} pending={cards} layout={layout} />
    </div>
  );
}
