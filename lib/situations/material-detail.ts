/**
 * Everything known about one component (V2 §18, §15).
 *
 * The material clock says *when* a component has to be ordered. This says
 * whether the planner can believe that date and act on it: how much is
 * required against how much went last season, what the lead time really is
 * against what the system assumes, who actually supplies it, and how much is
 * already on order.
 *
 * Two rules it exists to hold:
 *
 * - The system lead time is never called wrong. History differing from the
 *   planning assumption is a reason to look, not proof of an error (V2 §18.5).
 * - Coverage is stated against what is *required*, so "60% already on order"
 *   can never be read off a requirement the page is not showing.
 *
 * Pure: no React.
 */

import type { PlanningDataset } from "@/types/dataset";
import type { MaterialExposureRow, PlanningSituation } from "@/types/situation";
import { percentile } from "./suppliers";

export interface LeadTimeSample {
  count: number;
  systemDays?: number;
  medianDays: number;
  p80Days: number;
  minDays: number;
  maxDays: number;
  /** ISO dates of the earliest and latest purchase order in the sample. */
  from?: string;
  to?: string;
  /** Every non-outlier elapsed time, for the distribution. */
  values: number[];
}

export interface MaterialDetail {
  materialId: string;
  materialName: string;
  componentType: string;
  uom: string;

  /* --- what this season needs --- */
  requiredBase: number;
  requiredLow: number;
  requiredHigh: number;
  /** Requirement implied by what the same items actually shipped last season. */
  priorSeasonRequirement?: number;
  /** Fractional change against last season, when it can be computed. */
  vsPriorSeason?: number;

  /* --- what is already covered --- */
  onHandQty: number;
  openPoQty: number;
  plannedReceiptQty: number;
  /** onHand + openPo + plannedReceipts, against the requirement. */
  coveredQty: number;
  /** Share of the requirement already covered, 0-1. Capped at 1. */
  coveragePct: number;
  /** What still has to be ordered. */
  outstandingQty: number;

  /* --- what it takes to get --- */
  sample?: LeadTimeSample;
  // Who supplies it lives in `supplierComparison` (./suppliers.ts), which the
  // drawer and the release dialog both read, so they cannot disagree.
  leadTimeDays: number;
  leadTimeBasis: MaterialExposureRow["leadTimeBasis"];
  decisionDate: string;
  weeksToDecision: number;

  /* --- who needs it --- */
  contributors: MaterialExposureRow["contributors"];
  status: MaterialExposureRow["status"];
  reason: string;
  hasInferredSource: boolean;
  /** Set when there is not enough history to say anything about lead time. */
  sampleUnavailableReason?: string;
}

/** Below this a sample is an anecdote rather than a distribution. */
const MIN_SAMPLE = 5;

export function materialDetail(
  dataset: PlanningDataset,
  situation: PlanningSituation,
  materialId: string
): MaterialDetail | undefined {
  const row = situation.materialExposure.rows.find((r) => r.materialId === materialId);
  if (!row) return undefined;

  /* ---- lead-time history and who supplies it ---- */
  const receipts = dataset.leadTimeHistory.filter((r) => r.materialId === materialId);
  const values = receipts.map((r) => r.actualLeadTimeDays).filter((d) => Number.isFinite(d) && d > 0);

  const sample: LeadTimeSample | undefined =
    values.length >= MIN_SAMPLE
      ? {
          count: values.length,
          systemDays: receipts.find((r) => r.systemLeadTimeDays !== undefined)?.systemLeadTimeDays,
          medianDays: percentile(values, 0.5),
          p80Days: percentile(values, 0.8),
          minDays: Math.min(...values),
          maxDays: Math.max(...values),
          from: receipts.map((r) => r.poDate).sort()[0],
          to: receipts.map((r) => r.poDate).sort()[receipts.length - 1],
          values: [...values].sort((a, b) => a - b),
        }
      : undefined;

  /* ---- what is already covered ---- */
  const supply = dataset.inventorySupply.filter((r) => r.materialId === materialId);
  // On hand is a position, not a flow — the largest month is what is actually
  // there, whereas summing months would count the same stock repeatedly.
  const onHandQty = supply.reduce((max, r) => Math.max(max, r.onHandQty), 0);
  const openPoQty = supply.reduce((sum, r) => sum + r.openPoQty, 0);
  const plannedReceiptQty = supply.reduce((sum, r) => sum + r.plannedReceiptQty, 0);
  const coveredQty = onHandQty + openPoQty + plannedReceiptQty;

  /* ---- against last season ---- */
  const priorSeasonRequirement = priorRequirement(situation, row);

  return {
    materialId,
    materialName: row.materialName,
    componentType: row.componentType,
    uom: row.uom,

    requiredBase: row.requirementBase,
    requiredLow: row.requirementLow,
    requiredHigh: row.requirementHigh,
    priorSeasonRequirement,
    vsPriorSeason:
      priorSeasonRequirement && priorSeasonRequirement > 0
        ? (row.requirementBase - priorSeasonRequirement) / priorSeasonRequirement
        : undefined,

    onHandQty,
    openPoQty,
    plannedReceiptQty,
    coveredQty,
    coveragePct: row.requirementBase > 0 ? Math.min(1, coveredQty / row.requirementBase) : 0,
    outstandingQty: Math.max(0, row.requirementBase - coveredQty),

    sample,
    leadTimeDays: row.leadTimeDays,
    leadTimeBasis: row.leadTimeBasis,
    decisionDate: row.decisionDate,
    weeksToDecision: row.weeksToDecision,

    contributors: row.contributors,
    status: row.status,
    reason: row.reason,
    hasInferredSource: row.hasInferredSource,
    sampleUnavailableReason:
      sample === undefined
        ? `Only ${values.length} receipt${values.length === 1 ? "" : "s"} in the history — not enough to describe a lead time.`
        : undefined,
  };
}

/**
 * What the same products consumed of this component last season.
 *
 * Derived by scaling each contributor's own requirement back from what it
 * plans to carry to what it actually sold. Re-exploding the BOMs looked more
 * rigorous but was wrong twice over: it skipped analogue-derived items, whose
 * components do not come from a BOM keyed on their own id, and it summed every
 * prior item rather than the ones actually driving this requirement — which
 * compared twenty products' history against five products' plan and reported a
 * 65% fall that was really two different populations.
 *
 * Undefined when nothing contributes, because an absent comparison is not a
 * zero.
 */
function priorRequirement(
  situation: PlanningSituation,
  row: MaterialExposureRow
): number | undefined {
  const byId = new Map(situation.candidateItems.map((c) => [c.id, c]));

  let total = 0;
  let found = false;
  for (const contributor of row.contributors) {
    const candidate = byId.get(contributor.candidateId);
    if (!candidate || candidate.plannedUnits <= 0) continue;
    // Requirement is linear in units, so the prior-season figure is this
    // contributor's own requirement at last season's volume.
    total += contributor.requirement * (candidate.actualUnits / candidate.plannedUnits);
    found = true;
  }
  return found ? total : undefined;
}
