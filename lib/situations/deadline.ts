/**
 * How an item's own deadline reads on Reconcile.
 *
 * The date itself is computed by the engine (`candidate.deadline`: production
 * start minus the longest lead time among the item's components). This file
 * only turns it into what a planner scans a list by — how close it is, which
 * kind of component sets it, and why a row has no date at all.
 *
 * The weeks-left colour uses its own planner-facing bands, independent of the
 * Decide step's urgency: a list is scanned for what is close, and every dated
 * row gets a colour so none reads as "no information".
 *
 * Pure: no React.
 */

import type { CandidateItem } from "@/types/situation";

/** Risk tone for a weeks-left pill. */
export type DeadlineTone = "critical" | "warning" | "positive";

/** Weeks left at or under which a deadline reads critical (overdue included). */
export const DEADLINE_CRITICAL_WEEKS = 8;
/** Weeks left at or under which a deadline reads warning. */
export const DEADLINE_WARNING_WEEKS = 20;

/** Overdue or ≤ 8 weeks → critical; 9–20 weeks → warning; > 20 weeks → positive. */
export function deadlineTone(weeksAway: number): DeadlineTone {
  if (weeksAway <= DEADLINE_CRITICAL_WEEKS) return "critical";
  if (weeksAway <= DEADLINE_WARNING_WEEKS) return "warning";
  return "positive";
}

/** `7 wks left`, `1 wk left`, `this week`, `3 wks overdue`. */
export function weeksLeftLabel(weeksAway: number): string {
  if (weeksAway === 0) return "this week";
  const n = Math.abs(weeksAway);
  const unit = n === 1 ? "wk" : "wks";
  return weeksAway < 0 ? `${n} ${unit} overdue` : `${n} ${unit} left`;
}

/** A lead time in the unit the reference table used: `16 wks`, or days under a week. */
export function leadTimeLabel(days: number): string {
  if (days < 7) return `${Math.round(days)}d`;
  const weeks = Math.round(days / 7);
  return `${weeks} ${weeks === 1 ? "wk" : "wks"}`;
}

const COMPONENT_TAG: Record<string, { abbr: string; label: string }> = {
  RAW_MATERIAL: { abbr: "RM", label: "Raw material" },
  PACKAGING: { abbr: "PM", label: "Packaging material" },
  SEMI_FINISHED: { abbr: "SF", label: "Semi-finished" },
  FINISHED_COMPONENT: { abbr: "FC", label: "Finished component" },
  ARTWORK: { abbr: "ART", label: "Artwork" },
  OTHER: { abbr: "OTH", label: "Other component" },
};

/** The short class tag shown beside the lead time, and its long form for a title. */
export function componentTag(componentType: string): { abbr: string; label: string } {
  return COMPONENT_TAG[componentType] ?? { abbr: "OTH", label: "Other component" };
}

/**
 * Why a row has no deadline. A missing date is not "no rush" — it is a date
 * the data cannot produce, and the row says which input is absent.
 */
export function noDeadlineReason(candidate: CandidateItem, hasProductionWindow: boolean): string {
  if (!hasProductionWindow) return "No production window for this programme, so no date can be set.";
  if (candidate.derivation === "none") return "No bill of materials or analogue for this item, so no component sets a date.";
  return "None of this item's components has a lead time on record.";
}

/**
 * Sort key for the deadline column: soonest first when ascending. Rows that
 * need no decision date sit after every dated row, and rows with no date at
 * all come last, so neither can crowd out what is due.
 */
export function deadlineSortValue(candidate: CandidateItem): number {
  if (!candidate.deadline) return 2_000_000;
  if (candidate.disposition === "intentional_exit") return 1_000_000 + candidate.deadline.weeksAway;
  return candidate.deadline.weeksAway;
}
