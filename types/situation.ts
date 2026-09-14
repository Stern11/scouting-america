/**
 * The planner-facing planning object for V2.
 *
 * A `PlanningSituation` is one coherent story about future business that is
 * not yet fully represented at item level — "Halloween 2027", not "demand gap
 * #4". The V1 `PlanningGap` remains as an internal detected signal; a single
 * situation can contain several of them (V2 §38).
 */

import type { DateRange } from "./shared";
import type { MonthKey, PeriodKey } from "./dataset";

/**
 * Planner-friendly state. Deliberately four words, not a severity × type ×
 * confidence badge matrix (V2 §62).
 */
export type SituationState = "ACTION_NEEDED" | "MONITOR" | "FORMING" | "RECONCILED";

/**
 * Where a situation sits in the rolling-horizon lifecycle (V2 §57). Distinct
 * from `SituationState`, which is about planner attention rather than data
 * maturity.
 */
export type SituationLifecycle = "UNRESOLVED" | "PARTIALLY_FORMALIZED" | "FORMAL" | "RECONCILED";

/* ------------------------------------------------------------------ */
/* Attribute matching                                                  */
/* ------------------------------------------------------------------ */

/**
 * The attributes a prior item can be matched on. Matching is configurable
 * across these and always explains itself — we show which attributes matched,
 * never a bare similarity percentage (V2 §43).
 */
export type MatchDimension =
  | "brand"
  | "product_family"
  | "event"
  | "customer"
  | "channel"
  | "pack_format"
  | "pack_size"
  | "flavor_or_variant"
  | "formula_family"
  | "packaging_type"
  | "base_pack";

export interface MatchDimensionConfig {
  dimension: MatchDimension;
  /** Relative pull of this attribute. Only enabled dimensions contribute. */
  weight: number;
  enabled: boolean;
}

export interface MatchConfig {
  dimensions: MatchDimensionConfig[];
  /** Score at or above which a prior item counts as already represented. */
  threshold: number;
}

export interface DimensionOutcome {
  dimension: MatchDimension;
  /** Undefined on either side means the attribute could not be compared. */
  status: "same" | "different" | "not_comparable";
  historicalValue?: string;
  currentValue?: string;
}

export interface MatchResult {
  /** The current-plan item this prior item appears to be represented by. */
  matchedItemId?: string;
  matchedItemName?: string;
  /** Units the matched plan item carries, for comparing against prior actuals. */
  matchedUnits?: number;
  /** 0-1, weighted share of comparable enabled dimensions that agreed. */
  score: number;
  /** How many enabled dimensions could actually be compared. */
  comparedDimensions: number;
  outcomes: DimensionOutcome[];
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

/**
 * What the planner decided about one prior item (V2 §42). `unreviewed` is the
 * starting state — the product proposes, the planner disposes.
 */
export type ContributorDisposition =
  | "unreviewed"
  | "carry_forward"
  | "already_represented"
  | "intentional_exit"
  | "under_review"
  | "new_or_changed";

/**
 * Only `carry_forward` adds load downstream. Everything else is either already
 * counted in the formal plan, deliberately gone, or still being decided —
 * counting any of those would overstate the plan.
 */
export const LOAD_BEARING_DISPOSITIONS: readonly ContributorDisposition[] = ["carry_forward"];

/* ------------------------------------------------------------------ */
/* Carry-forward volume                                                */
/* ------------------------------------------------------------------ */

/** One comparable season, and what it holds. */
export interface SeasonOption {
  period: PeriodKey;
  units: number;
  value: number;
  itemCount: number;
}

/** One season's actuals for a SKU, oldest first (V2 §16.3). */
export interface SeasonPoint {
  period: PeriodKey;
  units: number;
  value?: number;
}

/**
 * How a candidate's carry-forward volume was arrived at.
 *
 * Kept structured rather than as a sentence so a screen can show the working —
 * which seasons, what growth, what it would have been without the override.
 */
export interface PlannedVolumeBasis {
  kind: "seasons" | "business_plan_growth" | "prior_actual" | "planner_override";
  /** Periods that fed the number, oldest first. */
  seasonsUsed: PeriodKey[];
  /** Units from the most recent season used. */
  baselineUnits: number;
  /** Fractional growth applied, e.g. 0.046 for +4.6%. Zero when overridden. */
  growthPct: number;
  /** What the basis implied before any planner override. */
  inferredUnits: number;
  /** One short line for the UI. */
  label: string;
}

/* ------------------------------------------------------------------ */
/* Analogous derivation                                                */
/* ------------------------------------------------------------------ */

/**
 * A comparable product a not-yet-specified item's components were read from
 * (V2 §17). Explained by naming attributes, never by a bare percentage.
 */
export interface AnalogueMatch {
  /** The analogue's own historical row id. */
  candidateId: string;
  itemId: string;
  itemName: string;
  period: PeriodKey;
  /** Weighted share of comparable attributes that agreed, 0-1. */
  similarity: number;
  same: string[];
  different: string[];
  componentCount: number;
  /** The planner has taken this analogue out of the blend. */
  excluded: boolean;
  /**
   * How much this analogue counts. Defaults to its share of the blend, led by
   * the closest comparable (`findAnalogues`); a planner's weight replaces it.
   */
  weight: number;
}

/** One component read from analogues rather than from the item's own BOM. */
export interface InferredBomLine {
  componentId: string;
  componentName: string;
  componentType: string;
  componentFamily?: string;
  uom: string;
  /** Weighted mean across the analogues that carry it. */
  quantityPerParent: number;
  scrapPct: number;
  planningStatus?: string;
  /** Share of analogue weight carrying this component at all, 0-1. */
  confidence: number;
  sources: { itemName: string; quantityPerParent: number }[];
}

/**
 * Where a candidate's components come from.
 *
 * `own_bom` is a specified product: its bill of materials exists and the
 * numbers are as firm as the volume driving them. `analogue` is a product real
 * enough to plan but not specified enough to explode — the components are read
 * from comparable products and must never be presented with the same firmness.
 * `none` is neither, and says so rather than showing an empty list.
 */
export type CandidateDerivation = "own_bom" | "analogue" | "none";

/** A prior-season item offered as an explanation for the unresolved amount. */
export interface CandidateItem {
  /** Stable id: the historical row id. */
  id: string;
  itemId: string;
  itemName: string;
  brand: string;
  productFamily: string;
  historicalPeriod: PeriodKey;
  actualUnits: number;
  /** Derived from actual_value when present, else units x the scope's price. */
  actualValue: number;
  /**
   * What this SKU carries forward: the historical actual moved by the season
   * basis, or the planner's own number. This — not `actualUnits` — is what
   * bears load downstream. `actualUnits` stays the historical fact.
   */
  plannedUnits: number;
  plannedValue: number;
  /** How `plannedUnits` was arrived at, so the number can explain itself. */
  plannedBasis: PlannedVolumeBasis;
  /** This SKU's actuals across every season in the basis, oldest first. */
  seasonHistory: SeasonPoint[];
  /** Whether the components come from this item's own BOM or from analogues. */
  derivation: CandidateDerivation;
  /** The comparable products used, when `derivation` is `analogue`. */
  analogues: AnalogueMatch[];
  /** One line saying where the components came from. */
  derivationLabel: string;
  /**
   * True when this product did not exist in the earlier comparable seasons —
   * an innovation, a renovation, a new pack. It behaves differently from a
   * repeat: there is less to reason from, and its components are more often
   * inferred than specified, so it is worth finding at a glance.
   */
  isNewThisSeason: boolean;
  disposition: ContributorDisposition;
  /** Set when the disposition came from matching rather than the planner. */
  proposedDisposition: ContributorDisposition;
  match: MatchResult;
  customer?: string;
  channel?: string;
  packFormat?: string;
  basePack?: string;
  formulaFamily?: string;
  primaryLineId?: string;
  status?: string;
  /**
   * The latest date this item can still be made in time: production start
   * minus the longest lead time among its components. Undefined when there is
   * no production window, no component picture, or no lead time to read.
   */
  deadline?: CandidateDeadline;
}

/** When an item has to be decided by, and which component sets that date. */
export interface CandidateDeadline {
  date: string;
  /** Whole weeks from planningNow. Negative means already passed. */
  weeksAway: number;
  /** The component whose lead time sets the date. */
  componentId: string;
  componentName: string;
  componentType: string;
  leadTimeDays: number;
}

/** The expected -> formal -> unresolved bridge shown on Reconcile (V2 §42). */
export interface ReconciliationBridge {
  expectedValue: number;
  formalValue: number;
  unresolvedValue: number;
  expectedUnits?: number;
  formalUnits: number;
  /** How many items the formal plan carries for this programme. */
  formalItemCount: number;
  unresolvedUnits: number;
  /** formal / expected, 0-1. */
  representedPct: number;
  /** Unresolved value that candidate items account for. */
  explainedValue: number;
  /** Unresolved value no candidate item accounts for. */
  unexplainedValue: number;
  /** Units the planner has actually accepted as carry-forward. */
  validatedUnits: number;
  validatedValue: number;
  currency: string;
}

/* ------------------------------------------------------------------ */
/* Downstream exposure                                                 */
/* ------------------------------------------------------------------ */

/** One line, one month. The unit of the capacity matrix (V2 §47). */
export interface CapacityCell {
  lineId: string;
  lineName: string;
  plant: string;
  period: MonthKey;
  availableHours: number;
  baseCalendarHours: number;
  plannedMaintenanceHours: number;
  projectDowntimeHours: number;
  laborConstraintHours: number;
  otherConstraintHours: number;
  customAdjustmentHours: number;
  targetUtilizationPct: number;
  formalHours: number;
  /** This programme's carry-forward hours. */
  unresolvedHours: number;
  /**
   * Every *other* programme's carry-forward hours on this line-month. Formal
   * load is plant-wide, and so is carry-forward: a line does not know which
   * programme an hour belongs to, so neither may its utilisation.
   */
  otherProgrammeHours: number;
  /** formalHours + otherProgrammeHours + unresolvedHours — the line as Overview shows it. */
  effectiveHours: number;
  /** formalHours / availableHours. Infinity guarded to 0 when no hours. */
  formalUtilization: number;
  /** effectiveHours / availableHours. */
  effectiveUtilization: number;
  /**
   * Which carry-forward SKUs produced `unresolvedHours`, largest first. The
   * per-SKU figure is computed anyway while summing; keeping it is what lets a
   * planner ask "what does this one item cost me on this line?" (V2 §47).
   */
  contributors: CapacityContributor[];
}

/** One SKU's share of a cell's unresolved hours. */
export interface CapacityContributor {
  candidateId: string;
  itemId: string;
  itemName: string;
  hours: number;
}

export interface CapacityExposure {
  cells: CapacityCell[];
  lines: { lineId: string; lineName: string; plant: string }[];
  periods: MonthKey[];
  /**
   * Lines this programme's carry-forward helps push past target in at least
   * one month. A line hot on formal work alone is not something Heizen found.
   */
  exposedLineIds: string[];
  /** The single worst cell by effective utilisation, if any. */
  peak?: CapacityCell;
  available: boolean;
  /** Planner-facing reason when `available` is false. */
  unavailableReason?: string;
  /**
   * Carry-forward SKUs that produced no hours because no line mapping covers
   * them. Silently dropping these would understate the load, so they are
   * reported rather than hidden (V2 §30.5).
   */
  unmappedItems: { candidateId: string; itemName: string; units: number }[];
}

/** V2 §44 — three states, not a numeric confidence badge. */
export type MaterialPlanningStatus = "PLAN_NOW" | "REVIEW" | "WAIT";

export interface MaterialExposureRow {
  materialId: string;
  materialName: string;
  componentType: string;
  componentFamily?: string;
  uom: string;
  /** Requirement implied by validated carry-forward units. */
  requirementLow: number;
  requirementBase: number;
  requirementHigh: number;
  /** Net of on-hand and inbound, only when Inventory_Supply was provided. */
  netRequirement?: number;
  onHandQty?: number;
  inboundQty?: number;
  status: MaterialPlanningStatus;
  /** One short line saying why it is in that status. */
  reason: string;
  /** Share of analogue BOMs that carry this component, 0-1. */
  analogueCoverage: number;
  leadTimeDays: number;
  leadTimeBasis: "system" | "historical_median" | "historical_p80" | "scenario";
  /** Latest date an order can be placed and still land before production. */
  decisionDate: string;
  /** Whole weeks from planningNow to decisionDate. Negative means overdue. */
  weeksToDecision: number;
  /** Which carry-forward SKUs require this component, largest first. */
  contributors: MaterialContributor[];
  /**
   * Whether this component is shared across several carry-forward SKUs or
   * belongs to just one.
   *
   * A shared component can be committed on lead time even while one of the
   * items using it is still under review — the others already justify it. A
   * component only one unsettled item needs cannot (V2 §15.6).
   */
  sourcing: "shared" | "item_specific";
  /** Set when `sourcing` is item_specific and that one item is not settled. */
  blockedByItemName?: string;
  /**
   * True when any part of this requirement was read from analogues rather than
   * from a real bill of materials. A range built partly on inference must not
   * read as firmly as one built on a specification.
   */
  hasInferredSource: boolean;
}

/** One SKU's share of a component's requirement. */
export interface MaterialContributor {
  candidateId: string;
  itemId: string;
  itemName: string;
  units: number;
  requirement: number;
  /** False when the planner has not settled this item's disposition. */
  settled: boolean;
  /** Whether this item's share was read from its own BOM or from analogues. */
  derivation: CandidateDerivation;
  /** For an analogue-derived share, how well evidenced the component is, 0-1. */
  inferredConfidence?: number;
}

export interface MaterialExposure {
  rows: MaterialExposureRow[];
  planNowCount: number;
  reviewCount: number;
  waitCount: number;
  /** The earliest decision date across PLAN_NOW and REVIEW rows. */
  earliestDecisionDate?: string;
  available: boolean;
  unavailableReason?: string;
  /**
   * Share of carry-forward units whose SKU actually has a BOM, 0-1. Items with
   * no BOM are excluded from the coverage denominator — absence of a BOM is not
   * evidence that a component is absent — but the gap is reported so the
   * numbers are never read as more complete than they are (V2 §30.5).
   */
  bomCoveragePct: number;
  /** Carry-forward SKUs with no BOM at all. */
  itemsWithoutBom: { candidateId: string; itemName: string; units: number }[];
}

/* ------------------------------------------------------------------ */
/* Decision runway                                                     */
/* ------------------------------------------------------------------ */

export type RunwayMarkerKind =
  | "today"
  | "material_commitment"
  | "capacity_decision"
  | "production_start"
  | "production_end"
  | "sales_start"
  | "sales_end";

export interface RunwayMarker {
  kind: RunwayMarkerKind;
  label: string;
  date: string;
  /** Whole weeks from planningNow. Negative means already passed. */
  weeksAway: number;
  /** The first thing that becomes irreversible (V2 §50). */
  isEarliestIrreversible: boolean;
  /** One short line — what this date actually commits. */
  detail?: string;
}

export interface DecisionRunway {
  today: string;
  markers: RunwayMarker[];
  earliest?: RunwayMarker;
  /** Whole weeks to the earliest irreversible decision. */
  weeksOfRunway?: number;
  productionWindow?: DateRange;
  salesWindow?: DateRange;
}

/* ------------------------------------------------------------------ */
/* The situation                                                       */
/* ------------------------------------------------------------------ */

export interface SituationEvidence {
  id: string;
  label: string;
  /** Which sheet or system the number came from. */
  source: string;
  value: string;
  detail?: string;
}

export interface PlanningSituation {
  id: string;
  title: string;
  eventOrProgram: string;
  /** Human-readable scope, e.g. "Ridgeline · Variety Bags · mass". */
  businessScope: string;
  planningPeriod: PeriodKey;
  state: SituationState;
  lifecycle: SituationLifecycle;

  bridge: ReconciliationBridge;
  candidateItems: CandidateItem[];

  /**
   * Every historical period comparable to this situation, oldest first, with
   * its size — so a planner can judge whether a season is worth including
   * before they include it.
   */
  availableSeasons: SeasonOption[];
  /** The periods currently forming the basis. */
  selectedSeasons: PeriodKey[];
  /** One line describing what the selected seasons imply. */
  seasonBasisLabel: string;

  capacityExposure: CapacityExposure;
  materialExposure: MaterialExposure;
  runway: DecisionRunway;

  productionWindow?: DateRange;
  salesWindow?: DateRange;
  /** Production months this situation's load lands in. */
  productionMonths: MonthKey[];

  evidence: SituationEvidence[];
  scenarioIds: string[];
  calculatedAt: string;
}

/**
 * A volume the planner tested in Scenario Lab and then committed.
 *
 * This is the governed provisional assumption from V2 §20.3: it bears load
 * like any other carry-forward number, but it is recorded as a decision — with
 * what it replaced and what it was based on — rather than written back into
 * the data it came from. The uploaded workbook is never rewritten.
 */
export interface VolumeCommitment {
  candidateId: string;
  itemName: string;
  units: number;
  /** What the season basis would have carried, for the reconciliation trail. */
  basisUnits: number;
  /** The basis label at the moment of committing. */
  basisLabel: string;
  /** From `dataset.metadata.planningNow`, never `Date.now()`. */
  committedAt: string;
  note?: string;
}

/**
 * A component the planner has released for ordering.
 *
 * The action Decide exists for. It does not place an order — nothing here
 * writes to a purchasing system — it records that the planner has taken the
 * decision, so the date stops counting down and the commitment is auditable.
 */
export interface MaterialRelease {
  materialId: string;
  materialName: string;
  /** Requirement at the moment of releasing, so the record stands alone. */
  quantity: number;
  uom: string;
  decisionDate: string;
  releasedAt: string;
  note?: string;
  /**
   * The supplier the planner chose to award it to. Absent for a release made
   * without supplier history to choose from — never guessed.
   */
  supplierId?: string;
  supplierName?: string;
}

/** Planner decisions that live outside the dataset and drive recomputation. */
export interface SituationOverrides {
  /** candidateItem.id -> disposition the planner chose. */
  dispositions: Record<string, ContributorDisposition>;
  /** Replaces the default matching configuration when set. */
  matchConfig?: MatchConfig;
  /**
   * Which historical periods form the planning basis. Absent means the most
   * recent season only, so nothing changes until a planner opts into more.
   */
  seasonBasis?: PeriodKey[];
  /** Volumes committed out of Scenario Lab, keyed by candidate id. */
  commitments?: Record<string, VolumeCommitment>;
  /** Components released for ordering, keyed by material id. */
  releases?: Record<string, MaterialRelease>;
}

export const EMPTY_SITUATION_OVERRIDES: SituationOverrides = { dispositions: {} };

/* ------------------------------------------------------------------ */
/* Scenario adjustments                                                */
/* ------------------------------------------------------------------ */

/**
 * What a planner can change in Scenario Lab (V2 §52).
 *
 * These are overrides, never edits. They are applied to a *copy* of the
 * dataset, so an uploaded workbook is never rewritten and baseline and
 * scenario stay structurally separate (V2 §53).
 *
 * Keys are composite so a change is addressable per line, per month, per
 * mapping — capacity in particular varies by both line and period, and a
 * single global number would lose exactly the detail that matters.
 */
export interface ScenarioAdjustments {
  /** `${lineId}::${period}` -> available hours for that line and month. */
  availableHours: Record<string, number>;
  /** `${lineId}` -> target utilisation, 0-1. */
  targetUtilization: Record<string, number>;
  /** `${itemOrFamilyId}::${lineId}` -> units per hour. */
  runRate: Record<string, number>;
  /** `${itemOrFamilyId}::${lineId}` -> share of that item's volume, 0-1. */
  allocation: Record<string, number>;
  /** `${materialId}` -> lead time in days. */
  leadTimeDays: Record<string, number>;
  /**
   * `${candidateId}` -> units that SKU carries forward.
   *
   * The demand-side lever. Everything else here is supply — this is the one
   * that answers "last year this sold 100 and it is not in the plan; what if I
   * carry 130 rather than the 108 the growth basis implies?"
   */
  volumeUnits: Record<string, number>;
  /**
   * `${candidateId}::${analogueCandidateId}` -> weight, 0-1.
   *
   * Zero excludes the analogue. Lets a planner say "that tin is not comparable
   * to this one" and see the inferred bill of materials re-blend (V2 §17.3).
   */
  analogueWeights: Record<string, number>;
}

export const EMPTY_ADJUSTMENTS: ScenarioAdjustments = {
  availableHours: {},
  targetUtilization: {},
  runRate: {},
  allocation: {},
  leadTimeDays: {},
  volumeUnits: {},
  analogueWeights: {},
};

export type ScenarioAdjustmentCategory = keyof ScenarioAdjustments;

/** One changed value, for the baseline-vs-scenario delta list (V2 §53). */
export interface AdjustmentDiff {
  category: ScenarioAdjustmentCategory;
  key: string;
  label: string;
  baseline: number;
  scenario: number;
  delta: number;
  unit: string;
}

export interface SituationScenario {
  id: string;
  name: string;
  situationId: string;
  adjustments: ScenarioAdjustments;
  note?: string;
  createdAt: string;
  updatedAt: string;
}
