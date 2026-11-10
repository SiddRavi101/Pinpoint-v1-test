/**
 * DRUG VOCABULARY: PENDING MEDICAL REVIEW.
 *
 * This list exists only so the rules can match what a medic says to a
 * consistent spelling. It is not a formulary, not a scope of practice and not
 * advice. Dr. Lang (or the team's medical director) owns this list and must
 * replace or approve it before the Dec 16 drill. Engineers do not edit
 * medical content; changes go through docs/quality/change-control.md.
 */
export const DRUG_LIST_VERSION = "drugs-0.1.0-pending-review";

export interface DrugName {
  name: string;
  aliases: string[];
}

export const DRUGS: DrugName[] = [
  { name: "oxygen", aliases: ["o2"] },
  { name: "aspirin", aliases: ["asa"] },
  { name: "acetaminophen", aliases: ["tylenol"] },
  { name: "ibuprofen", aliases: ["advil", "motrin"] },
  { name: "diphenhydramine", aliases: ["benadryl"] },
  { name: "epinephrine", aliases: ["epi", "epipen", "epi pen"] },
  { name: "ondansetron", aliases: ["zofran"] },
  { name: "naloxone", aliases: ["narcan"] },
  { name: "oral glucose", aliases: ["glucose gel", "glucose"] },
  { name: "albuterol", aliases: ["proventil", "ventolin"] },
  { name: "nitroglycerin", aliases: ["nitro"] },
  { name: "loratadine", aliases: ["claritin"] },
  { name: "cetirizine", aliases: ["zyrtec"] },
];
