/**
 * Demand planning, product family by product family, for one programme
 * (V2 §42, PRD §7.1).
 *
 * The question a demand planner brings to the lab: *last year we sold X, the
 * business wants Y, the formal plan says Z — do the items missing from this
 * year's plan explain the difference?* And then: *if I carry this SKU at 130
 * rather than 108, does the gap close?*
 *
 * Every figure reconciles to the situation it is built from:
 * - the total gap to target is the bridge's `unresolvedValue`;
 * - carry-forward revenue is the bridge's `validatedValue`;
 * - a SKU's revenue is its `plannedValue`, which moves with its units at that
 *   SKU's own unit price — so a scenario volume flows straight through.
 *
 * "Missing" means the planner (or matching) does not consider the item
 * represented in this year's plan: anything not `already_represented`. Those
 * split three ways — carrying forward (the only thing that bears load), still
 * to decide, and intentional exit, which is shown but never counted as
 * explaining the gap.
 *
 * Grouping is by product family — the level business targets are set at.
 * A business plan row with no family is never spread across families: its
 * target lands in an "Unassigned family" row, flagged `unassigned`.
 */

import type { PeriodKey, PlanningDataset } from "@/types/dataset";
import type { CandidateItem, ContributorDisposition, PlanningSituation } from "@/types/situation";
import { eventLabel, programLabel } from "@/lib/dataset/periods";
import { fmtMoney, fmtPct } from "@/lib/utils/format";

/** The row a business target with no product family is reported under. */
export const UNASSIGNED_FAMILY = "Unassigned family";

export type MissingBucket = "carry_forward" | "to_decide" | "exit";

/** Undefined means the item is already represented in this year's plan. */
export function bucketOf(disposition: ContributorDisposition): MissingBucket | undefined {
  if (disposition === "already_represented") return undefined;
  if (disposition === "carry_forward") return "carry_forward";
  if (disposition === "intentional_exit") return "exit";
  return "to_decide";
}

export interface DemandSku {
  candidateId: string;
  itemName: string;
  productFamily: string;
  packFormat?: string;
  /** Did not exist in the earlier comparable seasons. */
  isNewThisSeason: boolean;
  disposition: ContributorDisposition;
  bucket: MissingBucket;
  actualUnits: number;
  actualValue: number;
  /** What the season basis carries before any planner number. */
  basisUnits: number;
  plannedUnits: number;
  plannedValue: number;
}

export interface MissingRevenue {
  carryForwardValue: number;
  carryForwardUnits: number;
  toDecideValue: number;
  toDecideUnits: number;
  exitValue: number;
  exitUnits: number;
  itemCount: number;
}

export interface DemandRow {
  productFamily: string;
  lyUnits: number;
  lyValue: number;
  targetValue: number;
  targetUnits?: number;
  /** target ÷ LY − 1. Undefined without a last season to compare with. */
  targetGrowthPct?: number;
  /** The business plan's own growth figure, value-weighted across its rows. */
  businessGrowthPct?: number;
  formalUnits: number;
  formalValue: number;
  /** formal ÷ LY − 1. */
  planVsLyPct?: number;
  /** max(0, target − formal). */
  gapToTargetValue: number;
  /** max(0, LY − formal): the plan is below what was sold last year. */
  planBelowLyValue: number;
  missing: MissingRevenue;
  /**
   * Carry-forward ÷ gap to target — the committed share, and the one the
   * colour follows. Undefined when there is no gap.
   */
  explainedByCarryPct?: number;
  /** (carry-forward + to decide) ÷ gap to target: what it could reach if every open SKU were carried. */
  explainsTargetPct?: number;
  /** Band of `explainedByCarryPct`. */
  explainedBand: ExplainedBand;
  /** (carry-forward + to decide) ÷ (LY − formal). Undefined when the plan is not below LY. */
  explainsLyPct?: number;
  /** Gap to target no missing item accounts for. */
  unexplainedValue: number;
  /** max(0, target − formal − carry-forward): what this plan still leaves open. */
  remainingGapValue: number;
}

export interface DemandFamily extends DemandRow {
  skus: DemandSku[];
  /** Holds business targets that name no product family. */
  unassigned: boolean;
}

export interface DemandPlan {
  situationId: string;
  title: string;
  currency: string;
  /** The season "last year" refers to. */
  lySeason?: PeriodKey;
  families: DemandFamily[];
  total: DemandRow;
}

interface Totals {
  lyUnits: number;
  lyValue: number;
  targetValue: number;
  targetUnits?: number;
  growthWeighted: number;
  growthWeight: number;
  formalUnits: number;
  formalValue: number;
  missing: MissingRevenue;
}

const emptyMissing = (): MissingRevenue => ({
  carryForwardValue: 0,
  carryForwardUnits: 0,
  toDecideValue: 0,
  toDecideUnits: 0,
  exitValue: 0,
  exitUnits: 0,
  itemCount: 0,
});

const emptyTotals = (): Totals => ({
  lyUnits: 0,
  lyValue: 0,
  targetValue: 0,
  targetUnits: 0,
  growthWeighted: 0,
  growthWeight: 0,
  formalUnits: 0,
  formalValue: 0,
  missing: emptyMissing(),
});

function finish(productFamily: string, t: Totals): DemandRow {
  const gapToTargetValue = Math.max(0, t.targetValue - t.formalValue);
  const planBelowLyValue = Math.max(0, t.lyValue - t.formalValue);
  const explaining = t.missing.carryForwardValue + t.missing.toDecideValue;
  return {
    productFamily,
    lyUnits: t.lyUnits,
    lyValue: t.lyValue,
    targetValue: t.targetValue,
    targetUnits: t.targetUnits,
    targetGrowthPct: t.lyValue > 0 && t.targetValue > 0 ? t.targetValue / t.lyValue - 1 : undefined,
    businessGrowthPct: t.growthWeight > 0 ? t.growthWeighted / t.growthWeight : undefined,
    formalUnits: t.formalUnits,
    formalValue: t.formalValue,
    planVsLyPct: t.lyValue > 0 ? t.formalValue / t.lyValue - 1 : undefined,
    gapToTargetValue,
    planBelowLyValue,
    missing: t.missing,
    explainedByCarryPct: gapToTargetValue > 0 ? t.missing.carryForwardValue / gapToTargetValue : undefined,
    explainedBand: bandFor(gapToTargetValue > 0 ? t.missing.carryForwardValue / gapToTargetValue : undefined),
    explainsTargetPct: gapToTargetValue > 0 ? explaining / gapToTargetValue : undefined,
    explainsLyPct: planBelowLyValue > 0 ? explaining / planBelowLyValue : undefined,
    unexplainedValue: Math.max(0, gapToTargetValue - explaining),
    remainingGapValue: Math.max(0, t.targetValue - t.formalValue - t.missing.carryForwardValue),
  };
}

function addMissing(into: MissingRevenue, sku: DemandSku): void {
  into.itemCount += 1;
  if (sku.bucket === "carry_forward") {
    into.carryForwardValue += sku.plannedValue;
    into.carryForwardUnits += sku.plannedUnits;
  } else if (sku.bucket === "to_decide") {
    into.toDecideValue += sku.plannedValue;
    into.toDecideUnits += sku.plannedUnits;
  } else {
    into.exitValue += sku.plannedValue;
    into.exitUnits += sku.plannedUnits;
  }
}

function toSku(c: CandidateItem, bucket: MissingBucket): DemandSku {
  return {
    candidateId: c.id,
    itemName: c.itemName,
    productFamily: c.productFamily,
    packFormat: c.packFormat,
    isNewThisSeason: c.isNewThisSeason,
    disposition: c.disposition,
    bucket,
    actualUnits: c.actualUnits,
    actualValue: c.actualValue,
    basisUnits: c.plannedBasis.inferredUnits,
    plannedUnits: c.plannedUnits,
    plannedValue: c.plannedValue,
  };
}

const BUCKET_ORDER: Record<MissingBucket, number> = { carry_forward: 0, to_decide: 1, exit: 2 };

/**
 * SKU order within a family, by keys a scenario cannot move: bucket, units
 * sold last year, the season basis, then name. Sorting by planned value
 * re-shuffled the rows under the planner's cursor as they typed.
 */
function compareSkus(a: DemandSku, b: DemandSku): number {
  return (
    BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
    b.actualUnits - a.actualUnits ||
    b.basisUnits - a.basisUnits ||
    a.itemName.localeCompare(b.itemName) ||
    a.candidateId.localeCompare(b.candidateId)
  );
}

export function buildDemandPlan(dataset: PlanningDataset, situation: PlanningSituation): DemandPlan {
  const label = eventLabel(situation.eventOrProgram);
  const bridge = situation.bridge;
  // The same preference order the bridge uses for a price: target, then plan.
  const price =
    bridge.expectedUnits && bridge.expectedUnits > 0
      ? bridge.expectedValue / bridge.expectedUnits
      : bridge.formalUnits > 0
        ? bridge.formalValue / bridge.formalUnits
        : 0;

  const byFamily = new Map<string, Totals>();
  const skusByFamily = new Map<string, DemandSku[]>();
  const totalsFor = (family: string) => {
    let t = byFamily.get(family);
    if (!t) {
      t = emptyTotals();
      byFamily.set(family, t);
    }
    return t;
  };
  const total = emptyTotals();

  // Last year: the most recent comparable season, every SKU in it.
  const lySeason = situation.availableSeasons[situation.availableSeasons.length - 1]?.period;
  if (lySeason) {
    for (const row of dataset.historicalItems) {
      if (row.historicalPeriod !== lySeason) continue;
      const comparable =
        programLabel(row.historicalPeriod) === label ||
        (row.eventOrProgram !== undefined && eventLabel(row.eventOrProgram) === label);
      if (!comparable) continue;
      const value = row.actualValue ?? row.actualUnits * price;
      for (const t of [totalsFor(row.productFamily), total]) {
        t.lyUnits += row.actualUnits;
        t.lyValue += value;
      }
    }
  }

  // This year's consensus target.
  const targetRows = dataset.businessPlans.filter(
    (r) => r.planningPeriod === situation.planningPeriod && eventLabel(r.eventOrProgram) === label
  );
  const familyOfTarget = (row: (typeof targetRows)[number]) => row.productFamily?.trim() || UNASSIGNED_FAMILY;
  for (const row of targetRows) {
    for (const t of [totalsFor(familyOfTarget(row)), total]) {
      t.targetValue += row.targetValue;
      t.targetUnits = t.targetUnits === undefined || row.targetUnits === undefined ? undefined : t.targetUnits + row.targetUnits;
      if (row.growthPct !== undefined) {
        t.growthWeighted += row.growthPct * row.targetValue;
        t.growthWeight += row.targetValue;
      }
    }
  }

  // This year's formal plan — the same scope rule the bridge uses.
  for (const row of dataset.currentPlanItems) {
    if (row.planningPeriod !== situation.planningPeriod) continue;
    if (row.eventOrProgram && eventLabel(row.eventOrProgram) !== label) continue;
    const value = row.plannedValue ?? row.plannedUnits * price;
    for (const t of [totalsFor(row.productFamily), total]) {
      t.formalUnits += row.plannedUnits;
      t.formalValue += value;
    }
  }

  // Items missing from this year's plan.
  for (const candidate of situation.candidateItems) {
    const bucket = bucketOf(candidate.disposition);
    if (!bucket) continue;
    const sku = toSku(candidate, bucket);
    addMissing(totalsFor(candidate.productFamily).missing, sku);
    addMissing(total.missing, sku);
    const list = skusByFamily.get(candidate.productFamily) ?? [];
    list.push(sku);
    skusByFamily.set(candidate.productFamily, list);
  }

  // A family with no target rows has no unit target either, not a zero one.
  for (const [family, t] of byFamily) {
    if (!targetRows.some((r) => familyOfTarget(r) === family)) t.targetUnits = undefined;
  }
  if (targetRows.length === 0) total.targetUnits = undefined;

  const families: DemandFamily[] = [...byFamily.entries()]
    .map(([family, t]) => ({
      ...finish(family, t),
      unassigned: family === UNASSIGNED_FAMILY,
      skus: (skusByFamily.get(family) ?? []).sort(compareSkus),
    }))
    // The unassigned row sits last: it is a remainder, not a family. Target
    // and last year are inputs, so a scenario edit never re-orders families.
    .sort(
      (a, b) =>
        Number(a.unassigned) - Number(b.unassigned) ||
        b.targetValue - a.targetValue ||
        b.lyValue - a.lyValue ||
        a.productFamily.localeCompare(b.productFamily)
    );

  return {
    situationId: situation.id,
    title: situation.title,
    currency: bridge.currency,
    lySeason,
    families,
    total: finish("Total", total),
  };
}

/* ------------------------------------------------------------------ */
/* Plain language                                                      */
/* ------------------------------------------------------------------ */

/**
 * How much of the gap to target carry-forward revenue explains. Only
 * carry-forward is committed load, so the band reads that share alone —
 * "to decide" revenue is potential and never turns a row green.
 *
 * - covers:  ≥ 100%
 * - partial: 60% – 99%
 * - short:   < 60%
 */
export type ExplainedBand = "no_gap" | "covers" | "partial" | "short";

export const EXPLAINED_BANDS = { covers: 0.995, partial: 0.6 } as const;

export function bandFor(pct: number | undefined): ExplainedBand {
  if (pct === undefined) return "no_gap";
  if (pct >= EXPLAINED_BANDS.covers) return "covers";
  if (pct >= EXPLAINED_BANDS.partial) return "partial";
  return "short";
}

/** The risk tone a band is drawn in. */
export function bandTone(band: ExplainedBand): "neutral" | "positive" | "warning" | "critical" {
  if (band === "covers") return "positive";
  if (band === "partial") return "warning";
  if (band === "short") return "critical";
  return "neutral";
}

/** "Carry-forward explains 12% of the gap · 87% with to-decide · $3.7M still open". */
export function describeExplanation(row: DemandRow, currency: string): string {
  if (row.explainedBand === "no_gap") return "Plan meets the target";
  const open = row.remainingGapValue > 0.5 ? ` · ${fmtMoney(row.remainingGapValue, currency)} still open` : "";
  if (row.explainedBand === "covers") return "Carry-forward covers the gap to target";
  const withToDecide =
    row.missing.toDecideValue > 0.5 && row.explainsTargetPct !== undefined
      ? ` · ${fmtPct(row.explainsTargetPct)} with to-decide`
      : "";
  return `Carry-forward explains ${fmtPct(row.explainedByCarryPct ?? 0)} of the gap${withToDecide}${open}`;
}

/* ------------------------------------------------------------------ */
/* Scenario delta                                                      */
/* ------------------------------------------------------------------ */

export interface DemandChange {
  candidateId: string;
  itemName: string;
  productFamily: string;
  bucket: MissingBucket;
  unitsBefore: number;
  unitsAfter: number;
  valueDelta: number;
}

/** SKUs whose units the scenario moved, largest revenue change first. */
export function diffDemandPlans(baseline: DemandPlan, scenario: DemandPlan): DemandChange[] {
  const before = new Map(baseline.families.flatMap((f) => f.skus).map((s) => [s.candidateId, s]));
  return scenario.families
    .flatMap((b) => b.skus)
    .flatMap((s) => {
      const prior = before.get(s.candidateId);
      if (!prior || Math.abs(prior.plannedUnits - s.plannedUnits) < 0.5) return [];
      return [
        {
          candidateId: s.candidateId,
          itemName: s.itemName,
          productFamily: s.productFamily,
          bucket: s.bucket,
          unitsBefore: prior.plannedUnits,
          unitsAfter: s.plannedUnits,
          valueDelta: s.plannedValue - prior.plannedValue,
        },
      ];
    })
    .sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta));
}
