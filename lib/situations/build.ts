/**
 * Assembles `PlanningSituation` objects from a `PlanningDataset`.
 *
 * The whole product hangs off one number: the units the planner has validated
 * as carrying forward. Capacity hours, material requirements and decision
 * dates are all derived from that same figure, which is what makes the pages
 * reconcile with each other (V2 §11). Nothing here persists a derived value —
 * situations are rebuilt from (dataset + overrides) every time.
 *
 * Pure with respect to time: every date is measured against
 * `dataset.metadata.planningNow`, never `Date.now()`.
 */

import type {
  BomRow,
  CurrentPlanRow,
  HistoricalItemRow,
  ItemLineMappingRow,
  MonthKey,
  PeriodKey,
  PlanningDataset,
} from "@/types/dataset";
import type { DateRange } from "@/types/shared";
import type {
  CandidateItem,
  CapacityCell,
  CapacityContributor,
  InferredBomLine,
  MaterialContributor,
  CapacityExposure,
  DecisionRunway,
  MaterialExposure,
  MaterialExposureRow,
  MaterialPlanningStatus,
  PlanningSituation,
  ReconciliationBridge,
  RunwayMarker,
  SituationEvidence,
  SituationLifecycle,
  SituationOverrides,
  SituationState,
} from "@/types/situation";
import { EMPTY_SITUATION_OVERRIDES, LOAD_BEARING_DISPOSITIONS } from "@/types/situation";
import { buildCandidates, DEFAULT_MATCH_CONFIG } from "./matching";
import { blendAnalogueBoms, describeAnalogueBasis, findAnalogues } from "./analogues";
import {
  availablePeriods,
  collapseToSkus,
  defaultSelectedPeriods,
  describeSeasonBasis,
  seasonOptions,
} from "./volume";
import {
  addDays,
  eventLabel,
  formatMonthLabel,
  monthWeights,
  monthsBetween,
  periodYear,
  programLabel,
  shiftYears,
  unionRange,
  weeksBetween,
} from "@/lib/dataset/periods";

/** Used when a line row carries no target of its own. */
const DEFAULT_TARGET_UTILIZATION = 0.9;

/** Coverage at or above which an analogue-derived component is treated as settled. */
const STABLE_COVERAGE = 0.85;
/** Coverage below which a component is too thinly evidenced to plan. */
const THIN_COVERAGE = 0.5;

/**
 * Above this share of a component's requirement resting on weakly-evidenced
 * inference, it stops being something to commit and becomes something to
 * review.
 */
const MATERIALLY_INFERRED = 0.35;

/** Planning statuses on a BOM line that mean the component is still moving. */
const UNSETTLED_STATUS = /artwork|pending|unresolved|draft|tbc|tbd|provisional/i;

export interface BuildSituationsOptions {
  /** Per-situation planner decisions, keyed by situation id. */
  overridesBySituation?: Record<string, SituationOverrides>;
  /**
   * Scenario lead times by material id. Applied on top of whatever the data
   * supports, so the planner can test "what if printed film really takes 81
   * days" without editing the history it came from.
   */
  leadTimeOverrideDays?: Record<string, number>;
  /**
   * Scenario carry-forward volumes, keyed by situation id and then candidate
   * id. Threaded as an option rather than applied to a dataset copy on
   * purpose: the override replaces the *resolved plan* for a SKU, and must not
   * rewrite the historical actual it was derived from.
   *
   * Scoped by situation because a candidate id names a *product*, and the same
   * product can run in more than one programme. A flat map would let a volume
   * set for Halloween move the same product's Holiday plan too.
   *
   * Committed volumes are not passed here: they live in each situation's own
   * `overrides.commitments` and are applied from there, beneath these.
   */
  volumeOverridesBySituation?: Record<string, Record<string, number>>;
  /**
   * Scenario analogue weights by situation id, each keyed
   * `${candidateId}::${analogueId}`. Zero takes an analogue out of the blend
   * that derives a not-yet-specified item's components.
   */
  analogueWeightsBySituation?: Record<string, Record<string, number>>;
}

export function buildSituations(
  dataset: PlanningDataset,
  options: BuildSituationsOptions = {}
): PlanningSituation[] {
  const scopes = resolveScopes(dataset);
  // Formal line load is a property of the whole plan, not of one situation —
  // Halloween's unresolved hours land on a line that other programs already
  // occupy, so it is computed once across every formal item.
  const formalLoad = formalLineLoad(dataset);

  const built = scopes.map((scope) =>
    buildSituation(
      dataset,
      scope,
      formalLoad,
      options.overridesBySituation?.[scope.id] ?? EMPTY_SITUATION_OVERRIDES,
      options.leadTimeOverrideDays,
      options.volumeOverridesBySituation?.[scope.id],
      options.analogueWeightsBySituation?.[scope.id]
    )
  );

  return withPortfolioLoad(built, dataset.metadata.planningNow.slice(0, 10)).sort(
    (a, b) => b.bridge.unresolvedValue - a.bridge.unresolvedValue
  );
}

/**
 * Puts every programme's carry-forward on every programme's lines.
 *
 * Formal load was already plant-wide; carry-forward was not, so Halloween's
 * July cell on a line showed Halloween's hours on the formal plan while
 * Overview's line load — and Scenario Lab — showed Halloween's and Holiday's.
 * One line-month, two utilisations. A line cannot tell which programme an hour
 * belongs to, so neither may the figure a planner reads off it.
 *
 * A second pass because the other programmes' hours only exist once every
 * programme is built. Only what depends on utilisation is re-derived — the
 * capacity summary, the runway and the attention state; the bridge and every
 * unit figure are untouched. Attribution stays per programme: `unresolvedHours`
 * and `contributors` are still this programme's own.
 */
function withPortfolioLoad(situations: PlanningSituation[], now: string): PlanningSituation[] {
  const carryForward = new Map<string, number>();
  for (const s of situations) {
    for (const c of s.capacityExposure.cells) {
      const key = loadKey(c.lineId, c.period);
      carryForward.set(key, (carryForward.get(key) ?? 0) + c.unresolvedHours);
    }
  }

  return situations.map((s) => {
    if (!s.capacityExposure.available) return s;
    const cells = s.capacityExposure.cells.map((c) => {
      const otherProgrammeHours = Math.max(0, (carryForward.get(loadKey(c.lineId, c.period)) ?? 0) - c.unresolvedHours);
      const effectiveHours = c.formalHours + otherProgrammeHours + c.unresolvedHours;
      return {
        ...c,
        otherProgrammeHours,
        effectiveHours,
        effectiveUtilization: c.availableHours > 0 ? effectiveHours / c.availableHours : 0,
      };
    });
    const capacityExposure: CapacityExposure = { ...s.capacityExposure, cells, ...summarizeCells(cells) };
    const runway = buildRunway(now, s.productionWindow, s.salesWindow, s.materialExposure, capacityExposure);
    return {
      ...s,
      capacityExposure,
      runway,
      state: deriveState(s.bridge, runway, capacityExposure, s.lifecycle),
    };
  });
}

/**
 * The lines this programme's carry-forward helps push past target, and the
 * worst cell. A line past target on formal work alone is not something this
 * programme found — the same rule as Overview's exposed lines and Decisions.
 */
function summarizeCells(cells: readonly CapacityCell[]): Pick<CapacityExposure, "exposedLineIds" | "peak"> {
  return {
    exposedLineIds: [...new Set(cells.filter(breachesTarget).map((c) => c.lineId))],
    peak: cells.reduce<CapacityCell | undefined>(
      (worst, cell) => (worst === undefined || cell.effectiveUtilization > worst.effectiveUtilization ? cell : worst),
      undefined
    ),
  };
}

function breachesTarget(cell: CapacityCell): boolean {
  return cell.effectiveUtilization > cell.targetUtilizationPct && cell.unresolvedHours > 0;
}

/* ------------------------------------------------------------------ */
/* Scope resolution                                                    */
/* ------------------------------------------------------------------ */

interface SituationScope {
  id: string;
  planningPeriod: string;
  eventOrProgram: string;
  title: string;
  businessScope: string;
  currency: string;
  brands: string[];
  families: string[];
}

/**
 * One situation per (planning period, program). That is the level a planner
 * actually talks about — "Halloween 2027" — rather than one per gap type.
 */
function resolveScopes(dataset: PlanningDataset): SituationScope[] {
  const groups = new Map<string, SituationScope>();

  for (const plan of dataset.businessPlans) {
    const key = `${plan.planningPeriod}::${eventLabel(plan.eventOrProgram)}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.brands.includes(plan.brand)) existing.brands.push(plan.brand);
      if (plan.productFamily && !existing.families.includes(plan.productFamily)) {
        existing.families.push(plan.productFamily);
      }
      continue;
    }
    groups.set(key, {
      id: slug(key),
      planningPeriod: plan.planningPeriod,
      eventOrProgram: plan.eventOrProgram,
      title: plan.eventOrProgram,
      businessScope: "",
      currency: plan.currency ?? dataset.metadata.currency,
      brands: [plan.brand],
      families: plan.productFamily ? [plan.productFamily] : [],
    });
  }

  for (const scope of groups.values()) {
    // A scope line the planner can read at a glance, capped so it stays one line.
    const brands = scope.brands.slice(0, 2).join(", ") + (scope.brands.length > 2 ? ` +${scope.brands.length - 2}` : "");
    const families =
      scope.families.slice(0, 2).join(", ") + (scope.families.length > 2 ? ` +${scope.families.length - 2}` : "");
    scope.businessScope = [brands, families].filter(Boolean).join(" · ");
  }

  return [...groups.values()];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ------------------------------------------------------------------ */
/* One situation                                                       */
/* ------------------------------------------------------------------ */

function buildSituation(
  dataset: PlanningDataset,
  scope: SituationScope,
  formalLoad: Map<string, number>,
  overrides: SituationOverrides,
  leadTimeOverrideDays?: Record<string, number>,
  volumeOverrideUnits?: Record<string, number>,
  analogueWeightOverrides?: Record<string, number>
): PlanningSituation {
  const now = dataset.metadata.planningNow.slice(0, 10);
  const label = eventLabel(scope.eventOrProgram);

  const businessRows = dataset.businessPlans.filter(
    (r) => r.planningPeriod === scope.planningPeriod && eventLabel(r.eventOrProgram) === label
  );
  const currentRows = dataset.currentPlanItems.filter((r) => inScopeCurrent(r, scope, label));

  // Every comparable season, not just the latest — the planner chooses which
  // of them form the basis, and older ones stay visible either way.
  const allPriorRows = comparableHistorical(dataset, scope, label);
  const seasons = seasonOptions(allPriorRows);
  const selectedSeasons = resolveSelectedSeasons(
    overrides.seasonBasis,
    availablePeriods(allPriorRows),
    allPriorRows
  );
  const businessGrowthPct = businessRows.find((r) => r.growthPct !== undefined)?.growthPct;

  // Collapse to one row per SKU *before* matching runs: three seasons of the
  // same product are three observations of one thing to plan, and letting each
  // compete separately for the same plan item would double-count it.
  //
  // A committed volume is part of the baseline from the moment it is committed.
  // It is read from this situation's own overrides — never from a map shared
  // across programmes — and a scenario value tested on top of it wins.
  const committedUnits = Object.fromEntries(
    Object.values(overrides.commitments ?? {}).map((c) => [c.candidateId, c.units])
  );
  const collapsed = collapseToSkus(allPriorRows, {
    selectedPeriods: selectedSeasons,
    businessGrowthPct,
    volumeOverrides: { ...committedUnits, ...volumeOverrideUnits },
  });
  const priorRows = collapsed.map((c) => c.row);
  const volumeById = new Map(collapsed.map((c) => [c.row.id, c]));

  const pricePerUnit = derivePrice(businessRows, currentRows, priorRows);
  const matchConfig = overrides.matchConfig ?? DEFAULT_MATCH_CONFIG;
  const candidates = buildCandidates(
    priorRows,
    currentRows,
    overrides.dispositions,
    matchConfig,
    pricePerUnit
  ).map((candidate) => {
    const volume = volumeById.get(candidate.id);
    if (!volume) return candidate;
    return {
      ...candidate,
      plannedUnits: volume.plannedUnits,
      // Fall back to the scope price when the history carried no value, so the
      // bridge still reconciles in money as well as units.
      plannedValue: volume.plannedValue || volume.plannedUnits * pricePerUnit,
      plannedBasis: volume.basis,
      seasonHistory: volume.seasonHistory,
      isNewThisSeason: volume.isNewThisSeason,
    } satisfies CandidateItem;
  });

  // A product can be real enough to plan before it is specified enough to
  // explode. Items with no bill of materials of their own read theirs from
  // comparable products instead of vanishing from the material picture.
  const bomByParent = new Map<string, BomRow[]>();
  for (const row of dataset.boms) {
    const list = bomByParent.get(row.parentItemId);
    if (list) list.push(row);
    else bomByParent.set(row.parentItemId, [row]);
  }
  const analoguePool = dataset.historicalItems;
  for (const candidate of candidates) {
    if (bomByParent.has(candidate.itemId)) {
      candidate.derivation = "own_bom";
      candidate.derivationLabel = "Specified — components come from this item's own bill of materials";
      continue;
    }
    const source = priorRows.find((r) => r.id === candidate.id);
    if (!source) continue;

    const excluded: string[] = [];
    const found = findAnalogues(source, analoguePool, bomByParent);
    const weighted = found.map((analogue) => {
      const override = analogueWeightOverrides?.[`${candidate.id}::${analogue.candidateId}`];
      if (override === undefined) return analogue;
      if (override <= 0) excluded.push(analogue.candidateId);
      return { ...analogue, weight: Math.max(0, Math.min(1, override)), excluded: override <= 0 };
    });

    candidate.analogues = weighted;
    candidate.derivation = weighted.some((a) => !a.excluded && a.weight > 0) ? "analogue" : "none";
    candidate.derivationLabel =
      candidate.derivation === "analogue"
        ? describeAnalogueBasis(weighted)
        : "No bill of materials, and no comparable product to read one from.";
  }

  const bridge = buildBridge(businessRows, currentRows, candidates, pricePerUnit, scope.currency);

  const productionWindow = resolveProductionWindow(scope, currentRows, priorRows);
  const salesWindow = resolveSalesWindow(scope, currentRows, priorRows);
  const productionMonths = productionWindow ? monthsBetween(productionWindow) : [];

  const capacityExposure = buildCapacityExposure(dataset, candidates, productionWindow, formalLoad);
  const materialExposure = buildMaterialExposure(
    dataset,
    candidates,
    productionWindow,
    now,
    leadTimeOverrideDays,
    bomByParent
  );
  assignCandidateDeadlines(candidates, dataset, productionWindow, now, leadTimeOverrideDays, bomByParent);
  const runway = buildRunway(now, productionWindow, salesWindow, materialExposure, capacityExposure);

  const lifecycle = deriveLifecycle(bridge);
  const state = deriveState(bridge, runway, capacityExposure, lifecycle);

  return {
    id: scope.id,
    title: scope.title,
    eventOrProgram: scope.eventOrProgram,
    businessScope: scope.businessScope,
    planningPeriod: scope.planningPeriod,
    state,
    lifecycle,
    bridge,
    candidateItems: candidates,
    availableSeasons: seasons,
    selectedSeasons,
    seasonBasisLabel: describeSeasonBasis(allPriorRows, selectedSeasons, businessGrowthPct),
    capacityExposure,
    materialExposure,
    runway,
    productionWindow,
    salesWindow,
    productionMonths,
    evidence: buildEvidence(dataset, scope, businessRows, currentRows, priorRows, bridge),
    scenarioIds: [],
    calculatedAt: dataset.metadata.planningNow,
  };
}

function inScopeCurrent(row: CurrentPlanRow, scope: SituationScope, label: string): boolean {
  if (row.planningPeriod !== scope.planningPeriod) return false;
  // An item that names a different programme in the same period belongs to that
  // programme, not this one.
  if (row.eventOrProgram && eventLabel(row.eventOrProgram) !== label) return false;
  return true;
}

/**
 * Every historical row describing the same programme, across all seasons.
 *
 * Which of those seasons actually form the planning basis is the planner's
 * call (see `resolveSelectedSeasons`); this function's job is only to find the
 * comparable history, not to narrow it.
 */
function comparableHistorical(
  dataset: PlanningDataset,
  scope: SituationScope,
  label: string
): HistoricalItemRow[] {
  return dataset.historicalItems.filter((r) => {
    const byPeriod = programLabel(r.historicalPeriod);
    const byEvent = r.eventOrProgram ? eventLabel(r.eventOrProgram) : undefined;
    return byPeriod === label || byEvent === label;
  });
}

/**
 * The seasons forming the basis. A planner selection wins, but only for
 * periods that actually exist — a stale selection from a previous dataset must
 * never silently empty the basis. Falls back to the most recent season.
 */
function resolveSelectedSeasons(
  chosen: readonly PeriodKey[] | undefined,
  available: readonly PeriodKey[],
  rows: readonly HistoricalItemRow[]
): PeriodKey[] {
  if (chosen && chosen.length > 0) {
    const valid = chosen.filter((p) => available.includes(p)).sort();
    if (valid.length > 0) return valid;
  }
  return defaultSelectedPeriods(rows);
}

/**
 * A price per unit derived from the data rather than assumed. Preference runs
 * from the most authoritative source down: the business target, then the
 * formal plan, then prior actuals.
 */
function derivePrice(
  businessRows: readonly { targetValue: number; targetUnits?: number }[],
  currentRows: readonly CurrentPlanRow[],
  priorRows: readonly HistoricalItemRow[]
): number {
  const bpValue = sum(businessRows.map((r) => (r.targetUnits ? r.targetValue : 0)));
  const bpUnits = sum(businessRows.map((r) => r.targetUnits ?? 0));
  if (bpUnits > 0 && bpValue > 0) return bpValue / bpUnits;

  const cpValue = sum(currentRows.map((r) => (r.plannedValue !== undefined ? r.plannedValue : 0)));
  const cpUnits = sum(currentRows.map((r) => (r.plannedValue !== undefined ? r.plannedUnits : 0)));
  if (cpUnits > 0 && cpValue > 0) return cpValue / cpUnits;

  const hValue = sum(priorRows.map((r) => r.actualValue ?? 0));
  const hUnits = sum(priorRows.map((r) => (r.actualValue !== undefined ? r.actualUnits : 0)));
  if (hUnits > 0 && hValue > 0) return hValue / hUnits;

  return 0;
}

/* ------------------------------------------------------------------ */
/* Bridge                                                              */
/* ------------------------------------------------------------------ */

function buildBridge(
  businessRows: readonly { targetValue: number; targetUnits?: number }[],
  currentRows: readonly CurrentPlanRow[],
  candidates: readonly CandidateItem[],
  pricePerUnit: number,
  currency: string
): ReconciliationBridge {
  const expectedValue = sum(businessRows.map((r) => r.targetValue));
  const targetUnits = businessRows.map((r) => r.targetUnits);
  const expectedUnits = targetUnits.every((u) => u !== undefined)
    ? sum(targetUnits as number[])
    : undefined;

  const formalUnits = sum(currentRows.map((r) => r.plannedUnits));
  const formalValue = sum(
    currentRows.map((r) => r.plannedValue ?? r.plannedUnits * pricePerUnit)
  );

  // The plan can legitimately exceed the target; a negative gap is not a gap.
  const unresolvedValue = Math.max(0, expectedValue - formalValue);
  const unresolvedUnits =
    expectedUnits !== undefined
      ? Math.max(0, expectedUnits - formalUnits)
      : pricePerUnit > 0
        ? unresolvedValue / pricePerUnit
        : 0;

  const loadBearing = candidates.filter((c) => LOAD_BEARING_DISPOSITIONS.includes(c.disposition));
  // The planned carry-forward, not the historical actual: what the planner has
  // accepted going forward is what bears load everywhere downstream.
  const validatedUnits = sum(loadBearing.map((c) => c.plannedUnits));
  const validatedValue = sum(loadBearing.map((c) => c.plannedValue));

  // Everything the planner has not ruled out is a candidate explanation for the
  // gap — items already represented in the formal plan are excluded because
  // counting them would double-count the plan.
  const explaining = candidates.filter(
    (c) => c.disposition !== "already_represented" && c.disposition !== "intentional_exit"
  );
  const explainedValue = Math.min(unresolvedValue, sum(explaining.map((c) => c.plannedValue)));

  return {
    expectedValue,
    formalValue,
    unresolvedValue,
    expectedUnits,
    formalUnits,
    formalItemCount: currentRows.length,
    unresolvedUnits,
    representedPct: expectedValue > 0 ? Math.min(1, formalValue / expectedValue) : 0,
    explainedValue,
    unexplainedValue: Math.max(0, unresolvedValue - explainedValue),
    validatedUnits,
    validatedValue,
    currency,
  };
}

/* ------------------------------------------------------------------ */
/* Capacity                                                            */
/* ------------------------------------------------------------------ */

/** Key for the formal-load map: `lineId::period`. */
function loadKey(lineId: string, period: MonthKey): string {
  return `${lineId}::${period}`;
}

/**
 * Hours the already-formal plan puts on each line and month, across every
 * programme. A situation's unresolved load sits on top of this.
 */
function formalLineLoad(dataset: PlanningDataset): Map<string, number> {
  const load = new Map<string, number>();
  for (const item of dataset.currentPlanItems) {
    const mappings = resolveMappings(dataset.itemLineMappings, {
      itemId: item.itemId,
      productFamily: item.productFamily,
    });
    if (mappings.length === 0) continue;
    const window = item.productionWindow;
    if (!window) continue;
    const weights = monthWeights(window);
    for (const mapping of mappings) {
      const share = lineShare(mapping, mappings);
      const hours = (item.plannedUnits * share) / mapping.runRateUnitsPerHour;
      for (const [month, weight] of weights) {
        const key = loadKey(mapping.lineId, month);
        load.set(key, (load.get(key) ?? 0) + hours * weight);
      }
    }
  }
  return load;
}

/**
 * The share of an item's volume one mapping sends to its line.
 *
 * Shares are normalised across the item's mappings so they always add to 100%:
 * a workbook declaring 100% on two lines means an even split, never double the
 * volume. Mappings without a share take an equal part before normalising.
 */
export function lineShare(mapping: ItemLineMappingRow, mappings: readonly ItemLineMappingRow[]): number {
  const raw = (m: ItemLineMappingRow) => m.allocationPct ?? 1 / mappings.length;
  const total = mappings.reduce((sum, m) => sum + Math.max(0, raw(m)), 0);
  return total > 0 ? Math.max(0, raw(mapping)) / total : 1 / mappings.length;
}

/**
 * Finds the line mappings for an item, preferring the most specific level
 * available. Unresolved future business often only resolves at family or
 * base-pack level, which is exactly why the mapping sheet supports three
 * levels (V2 §21).
 */
function resolveMappings(
  mappings: readonly ItemLineMappingRow[],
  keys: { itemId?: string; basePack?: string; productFamily?: string }
): ItemLineMappingRow[] {
  const byLevel = (level: ItemLineMappingRow["mappingLevel"], value: string | undefined) =>
    value === undefined
      ? []
      : mappings.filter(
          (m) => m.mappingLevel === level && m.itemOrFamilyId.toLowerCase() === value.toLowerCase()
        );

  const item = byLevel("ITEM", keys.itemId);
  if (item.length > 0) return item;
  const basePack = byLevel("BASE_PACK", keys.basePack);
  if (basePack.length > 0) return basePack;
  return byLevel("PRODUCT_FAMILY", keys.productFamily);
}

function buildCapacityExposure(
  dataset: PlanningDataset,
  candidates: readonly CandidateItem[],
  productionWindow: DateRange | undefined,
  formalLoad: Map<string, number>
): CapacityExposure {
  const empty: CapacityExposure = {
    cells: [],
    lines: [],
    periods: [],
    exposedLineIds: [],
    available: false,
    unmappedItems: [],
  };

  if (dataset.lineCapacity.length === 0) {
    return { ...empty, unavailableReason: "Capacity data not provided." };
  }
  if (dataset.itemLineMappings.length === 0) {
    return {
      ...empty,
      unavailableReason: "Add Item_Line_Mapping data to convert units into line hours.",
    };
  }
  if (!productionWindow) {
    return {
      ...empty,
      unavailableReason: "No production window on these items, so hours cannot be placed in a month.",
    };
  }

  const weights = monthWeights(productionWindow);
  const unresolvedByLineMonth = new Map<string, number>();
  // The per-SKU figure is computed anyway on the way to the sum. Keeping it is
  // the whole of per-item attribution — no extra data, no second pass.
  const contributorsByLineMonth = new Map<string, CapacityContributor[]>();
  const unmappedItems: CapacityExposure["unmappedItems"] = [];

  for (const candidate of candidates) {
    if (!LOAD_BEARING_DISPOSITIONS.includes(candidate.disposition)) continue;
    const mappings = resolveMappings(dataset.itemLineMappings, {
      itemId: candidate.itemId,
      basePack: candidate.basePack,
      productFamily: candidate.productFamily,
    });
    if (mappings.length === 0) {
      // Reported rather than skipped: these units are real load that no line
      // mapping can place, and hiding them would understate the plan.
      unmappedItems.push({
        candidateId: candidate.id,
        itemName: candidate.itemName,
        units: candidate.plannedUnits,
      });
      continue;
    }

    for (const mapping of mappings) {
      const share = lineShare(mapping, mappings);
      const hours = (candidate.plannedUnits * share) / mapping.runRateUnitsPerHour;
      for (const [month, weight] of weights) {
        const key = loadKey(mapping.lineId, month);
        const monthHours = hours * weight;
        unresolvedByLineMonth.set(key, (unresolvedByLineMonth.get(key) ?? 0) + monthHours);

        const list = contributorsByLineMonth.get(key);
        const existing = list?.find((c) => c.candidateId === candidate.id);
        if (existing) existing.hours += monthHours;
        else if (list) {
          list.push({
            candidateId: candidate.id,
            itemId: candidate.itemId,
            itemName: candidate.itemName,
            hours: monthHours,
          });
        } else {
          contributorsByLineMonth.set(key, [
            {
              candidateId: candidate.id,
              itemId: candidate.itemId,
              itemName: candidate.itemName,
              hours: monthHours,
            },
          ]);
        }
      }
    }
  }

  const periods = [...weights.keys()].sort();
  const rows = dataset.lineCapacity.filter((r) => periods.includes(r.period));
  const lineOrder = [...new Set(dataset.lineCapacity.map((r) => r.lineId))].sort();

  const cells: CapacityCell[] = [];
  for (const row of rows) {
    const formalHours = formalLoad.get(loadKey(row.lineId, row.period)) ?? 0;
    const unresolvedHours = unresolvedByLineMonth.get(loadKey(row.lineId, row.period)) ?? 0;
    const effectiveHours = formalHours + unresolvedHours;
    const available = row.availableHours;
    cells.push({
      lineId: row.lineId,
      lineName: row.lineName,
      plant: row.plant,
      period: row.period,
      availableHours: available,
      baseCalendarHours: row.baseCalendarHours,
      plannedMaintenanceHours: row.plannedMaintenanceHours,
      projectDowntimeHours: row.projectDowntimeHours,
      laborConstraintHours: row.laborConstraintHours,
      otherConstraintHours: row.otherConstraintHours,
      customAdjustmentHours: row.customAdjustmentHours,
      targetUtilizationPct: row.targetUtilizationPct ?? DEFAULT_TARGET_UTILIZATION,
      formalHours,
      unresolvedHours,
      // Filled in by `withPortfolioLoad` once every programme is built.
      otherProgrammeHours: 0,
      effectiveHours,
      formalUtilization: available > 0 ? formalHours / available : 0,
      effectiveUtilization: available > 0 ? effectiveHours / available : 0,
      contributors: [...(contributorsByLineMonth.get(loadKey(row.lineId, row.period)) ?? [])].sort(
        (a, b) => b.hours - a.hours
      ),
    });
  }

  const { exposedLineIds, peak } = summarizeCells(cells);

  return {
    cells,
    lines: lineOrder
      .map((lineId) => {
        const row = dataset.lineCapacity.find((r) => r.lineId === lineId);
        return row ? { lineId, lineName: row.lineName, plant: row.plant } : undefined;
      })
      .filter((l): l is { lineId: string; lineName: string; plant: string } => l !== undefined),
    periods,
    exposedLineIds,
    peak,
    available: true,
    unmappedItems,
  };
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

function buildMaterialExposure(
  dataset: PlanningDataset,
  candidates: readonly CandidateItem[],
  productionWindow: DateRange | undefined,
  now: string,
  leadTimeOverrideDays: Record<string, number> | undefined,
  bomByParent: ReadonlyMap<string, BomRow[]>
): MaterialExposure {
  const empty: MaterialExposure = {
    rows: [],
    planNowCount: 0,
    reviewCount: 0,
    waitCount: 0,
    available: false,
    bomCoveragePct: 0,
    itemsWithoutBom: [],
  };

  if (dataset.boms.length === 0) {
    return { ...empty, unavailableReason: "Add BOM data to calculate material exposure." };
  }

  const loadBearing = candidates.filter((c) => LOAD_BEARING_DISPOSITIONS.includes(c.disposition));
  if (loadBearing.length === 0) {
    return {
      ...empty,
      available: true,
      unavailableReason: "No items are marked carry forward yet, so nothing is required.",
    };
  }

  // An item with neither a bill of materials nor a comparable product to read
  // one from is not evidence that a component is absent — it is evidence that
  // we do not know. Counting it in the denominator would deflate every
  // component's coverage and wrongly push materials to WAIT, so it is excluded
  // here and reported separately instead.
  const explodable = loadBearing.filter((c) => c.derivation !== "none");
  const itemsWithoutBom = loadBearing
    .filter((c) => c.derivation === "none")
    .map((c) => ({ candidateId: c.id, itemName: c.itemName, units: c.plannedUnits }));

  const allValidatedUnits = sum(loadBearing.map((c) => c.plannedUnits));
  // Coverage is unit-weighted: a component present on the BOMs of the items
  // carrying most of the volume is better evidenced than one on a small item.
  const totalUnits = sum(explodable.map((c) => c.plannedUnits));
  const bomCoveragePct = allValidatedUnits > 0 ? totalUnits / allValidatedUnits : 0;

  const accum = new Map<
    string,
    {
      row: BomRow | InferredBomLine;
      requirement: number;
      coveredUnits: number;
      unsettled: boolean;
      contributors: MaterialContributor[];
    }
  >();

  for (const candidate of explodable) {
    // Either the item's own specification, or the blend of comparable products
    // standing in for one it does not have yet.
    const own = bomByParent.get(candidate.itemId);
    const lines: (BomRow | InferredBomLine)[] =
      own ?? blendAnalogueBoms(candidate.analogues, bomByParent);

    // A component is only committable ahead of the item if the item itself is
    // settled; `under_review` volume can still evaporate.
    const settled = candidate.disposition === "carry_forward";
    for (const line of lines) {
      const scrap = line.scrapPct ?? 0;
      const requirement = candidate.plannedUnits * line.quantityPerParent * (1 + scrap);
      const inferredConfidence = "confidence" in line ? line.confidence : undefined;
      const contributor: MaterialContributor = {
        candidateId: candidate.id,
        itemId: candidate.itemId,
        itemName: candidate.itemName,
        units: candidate.plannedUnits,
        requirement,
        settled,
        derivation: candidate.derivation,
        inferredConfidence,
      };
      const existing = accum.get(line.componentId);
      const unsettled =
        line.componentType === "ARTWORK" || UNSETTLED_STATUS.test(line.planningStatus ?? "");
      if (existing) {
        existing.requirement += requirement;
        existing.coveredUnits += candidate.plannedUnits;
        existing.unsettled = existing.unsettled || unsettled;
        existing.contributors.push(contributor);
      } else {
        accum.set(line.componentId, {
          row: line,
          requirement,
          coveredUnits: candidate.plannedUnits,
          unsettled,
          contributors: [contributor],
        });
      }
    }
  }

  const leadTimes = leadTimeStats(dataset);
  const inventory = inventoryByMaterial(dataset);
  const productionStart = productionWindow?.start;

  const rows: MaterialExposureRow[] = [...accum.entries()].map(([materialId, entry]) => {
    const coverage = totalUnits > 0 ? entry.coveredUnits / totalUnits : 0;
    // Only downgrade when the requirement *materially* rests on inference. A
    // component five specified items need is orderable whatever the sixth,
    // unspecified one turns out to be — the same reasoning as the shared vs
    // item-specific split.
    const inferredWeakness = contributorInference(entry.contributors);
    const status = classifyMaterial(
      entry.row,
      coverage,
      entry.unsettled,
      inferredWeakness > MATERIALLY_INFERRED
    );
    const lead = leadTimes.get(materialId);
    const override = leadTimeOverrideDays?.[materialId];
    const leadTimeDays = override ?? lead?.days ?? 0;
    const decisionDate = productionStart ? addDays(productionStart, -leadTimeDays) : now;
    const stock = inventory.get(materialId);

    // Only the volume itself is uncertain here, so the range is the requirement
    // scaled by how thinly the component is evidenced across analogues.
    // An inferred requirement is genuinely less certain than a specified one.
    // Widening the band is how that is said without changing the estimate.
    const spread = 1 - Math.min(0.45, (1 - coverage) * 0.5 + inferredWeakness * 0.25);

    const contributors = [...entry.contributors].sort((a, b) => b.requirement - a.requirement);
    const hasInferredSource = contributors.some((c) => c.derivation === "analogue");
    // Shared across several items means the component is justified whatever
    // happens to any one of them. Needed by exactly one item, and that item not
    // settled, means it cannot be committed ahead of the decision.
    const sourcing: MaterialExposureRow["sourcing"] =
      contributors.length > 1 ? "shared" : "item_specific";
    const soleUnsettled =
      sourcing === "item_specific" && contributors[0] !== undefined && !contributors[0].settled
        ? contributors[0].itemName
        : undefined;

    return {
      materialId,
      materialName: entry.row.componentName,
      componentType: entry.row.componentType,
      componentFamily: entry.row.componentFamily,
      uom: entry.row.uom,
      requirementLow: entry.requirement * spread,
      requirementBase: entry.requirement,
      requirementHigh: entry.requirement * (2 - spread),
      netRequirement: stock ? Math.max(0, entry.requirement - stock.total) : undefined,
      onHandQty: stock?.onHand,
      inboundQty: stock?.inbound,
      status,
      reason: materialReason(entry.row, coverage, entry.unsettled, status),
      analogueCoverage: coverage,
      leadTimeDays,
      leadTimeBasis: override !== undefined ? "scenario" : (lead?.basis ?? "system"),
      decisionDate,
      weeksToDecision: weeksBetween(now, decisionDate),
      contributors,
      sourcing,
      blockedByItemName: soleUnsettled,
      hasInferredSource,
    } satisfies MaterialExposureRow;
  });

  rows.sort((a, b) => a.weeksToDecision - b.weeksToDecision || b.requirementBase - a.requirementBase);

  const actionable = rows.filter((r) => r.status !== "WAIT");
  const earliest = actionable.reduce<string | undefined>(
    (min, r) => (min === undefined || r.decisionDate < min ? r.decisionDate : min),
    undefined
  );

  return {
    rows,
    planNowCount: rows.filter((r) => r.status === "PLAN_NOW").length,
    reviewCount: rows.filter((r) => r.status === "REVIEW").length,
    waitCount: rows.filter((r) => r.status === "WAIT").length,
    earliestDecisionDate: earliest,
    available: true,
    bomCoveragePct,
    itemsWithoutBom,
  };
}

/**
 * Readiness is about evidence and settledness, not a single confidence number.
 * A stable raw ingredient that every analogue shares can be planned; printed
 * packaging that depends on unreleased artwork cannot, however well evidenced
 * the volume is (V2 §15.6 — never imply uncertain packaging is orderable).
 */
function classifyMaterial(
  row: BomRow | InferredBomLine,
  coverage: number,
  unsettled: boolean,
  inferred: boolean
): MaterialPlanningStatus {
  if (unsettled) return "WAIT";
  if (coverage < THIN_COVERAGE) return "WAIT";
  const isIngredient = row.componentType === "RAW_MATERIAL" || row.componentType === "SEMI_FINISHED";
  // A stable ingredient read from comparable products is a reasonable thing to
  // review; it is not a reasonable thing to commit as though it were specified.
  if (isIngredient && coverage >= STABLE_COVERAGE) return inferred ? "REVIEW" : "PLAN_NOW";
  return "REVIEW";
}

/**
 * How much of a component's requirement rests on inference, weighted by how
 * well evidenced each inferred share is. Zero when every share came from a
 * real bill of materials.
 */
function contributorInference(contributors: readonly MaterialContributor[]): number {
  const total = sum(contributors.map((c) => c.requirement));
  if (total <= 0) return 0;
  const weak = sum(
    contributors
      .filter((c) => c.derivation === "analogue")
      .map((c) => c.requirement * (1 - (c.inferredConfidence ?? 0.5)))
  );
  return Math.min(1, weak / total);
}

function materialReason(
  row: BomRow | InferredBomLine,
  coverage: number,
  unsettled: boolean,
  status: MaterialPlanningStatus
): string {
  if (unsettled) {
    return row.componentType === "ARTWORK"
      ? "Artwork is not released."
      : "Specification is still moving.";
  }
  const pct = Math.round(coverage * 100);
  if (status === "PLAN_NOW") return `Stable ingredient, on ${pct}% of comparable items.`;
  if (coverage < THIN_COVERAGE) return `Only on ${pct}% of comparable items.`;
  return `Packaging decision follows the final item, on ${pct}% of comparable items.`;
}

/**
 * Every candidate's own deadline: the date its longest-lead component has to
 * be ordered for the item to be built on time.
 *
 * Set on every candidate — not only carry-forward ones — because the date an
 * undecided item stops being possible is exactly what tells a planner which
 * decision to make first. Reads the same components the material exposure
 * explodes (own BOM, else the analogue blend) and the same lead times,
 * including a scenario override.
 */
function assignCandidateDeadlines(
  candidates: CandidateItem[],
  dataset: PlanningDataset,
  productionWindow: DateRange | undefined,
  now: string,
  leadTimeOverrideDays: Record<string, number> | undefined,
  bomByParent: ReadonlyMap<string, BomRow[]>
): void {
  const productionStart = productionWindow?.start;
  if (!productionStart) return;
  const leadTimes = leadTimeStats(dataset);

  for (const candidate of candidates) {
    if (candidate.derivation === "none") continue;
    const lines: (BomRow | InferredBomLine)[] =
      bomByParent.get(candidate.itemId) ?? blendAnalogueBoms(candidate.analogues, bomByParent);

    let longest: { line: BomRow | InferredBomLine; days: number } | undefined;
    for (const line of lines) {
      const days = leadTimeOverrideDays?.[line.componentId] ?? leadTimes.get(line.componentId)?.days;
      if (days === undefined) continue;
      if (!longest || days > longest.days) longest = { line, days };
    }
    if (!longest) continue;

    const date = addDays(productionStart, -longest.days);
    candidate.deadline = {
      date,
      weeksAway: weeksBetween(now, date),
      componentId: longest.line.componentId,
      componentName: longest.line.componentName,
      componentType: longest.line.componentType,
      leadTimeDays: longest.days,
    };
  }
}

export interface LeadTimeStat {
  days: number;
  basis: "system" | "historical_median" | "historical_p80";
}

/**
 * Observed lead time per material. The P80 is used rather than the median
 * because a material decision date that is beaten 50% of the time is not a
 * deadline. Where there is no history, the system assumption stands and is
 * labelled as such rather than dressed up as observed.
 */
export function leadTimeStats(dataset: PlanningDataset): Map<string, LeadTimeStat> {
  const byMaterial = new Map<string, number[]>();
  const systemByMaterial = new Map<string, number>();

  for (const row of dataset.leadTimeHistory) {
    const list = byMaterial.get(row.materialId);
    if (list) list.push(row.actualLeadTimeDays);
    else byMaterial.set(row.materialId, [row.actualLeadTimeDays]);
    if (row.systemLeadTimeDays !== undefined) systemByMaterial.set(row.materialId, row.systemLeadTimeDays);
  }

  const out = new Map<string, LeadTimeStat>();
  for (const [materialId, values] of byMaterial) {
    if (values.length === 0) continue;
    if (values.length < 5) {
      const system = systemByMaterial.get(materialId);
      if (system !== undefined) {
        out.set(materialId, { days: system, basis: "system" });
        continue;
      }
    }
    out.set(materialId, { days: percentile(values, 0.8), basis: "historical_p80" });
  }
  for (const [materialId, system] of systemByMaterial) {
    if (!out.has(materialId)) out.set(materialId, { days: system, basis: "system" });
  }
  return out;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function inventoryByMaterial(
  dataset: PlanningDataset
): Map<string, { onHand: number; inbound: number; total: number }> {
  const out = new Map<string, { onHand: number; inbound: number; total: number }>();
  for (const row of dataset.inventorySupply) {
    const existing = out.get(row.materialId) ?? { onHand: 0, inbound: 0, total: 0 };
    // On-hand is a position, not a flow — the latest month stands rather than
    // summing every month, which would count the same stock repeatedly.
    existing.onHand = Math.max(existing.onHand, row.onHandQty);
    existing.inbound += row.openPoQty + row.plannedReceiptQty;
    existing.total = existing.onHand + existing.inbound;
    out.set(row.materialId, existing);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Windows and runway                                                  */
/* ------------------------------------------------------------------ */

/**
 * The production window for the situation. Prefers what the formal plan
 * already says; falls back to the prior season shifted forward by the year
 * difference, which is how a planner would reason about a season that has no
 * items yet.
 */
function resolveProductionWindow(
  scope: SituationScope,
  currentRows: readonly CurrentPlanRow[],
  priorRows: readonly HistoricalItemRow[]
): DateRange | undefined {
  const fromCurrent = unionRange(currentRows.map((r) => r.productionWindow));
  if (fromCurrent) return fromCurrent;
  return shiftedPrior(scope, priorRows, (r) => r.productionWindow);
}

function resolveSalesWindow(
  scope: SituationScope,
  currentRows: readonly CurrentPlanRow[],
  priorRows: readonly HistoricalItemRow[]
): DateRange | undefined {
  const fromCurrent = unionRange(currentRows.map((r) => r.salesWindow));
  if (fromCurrent) return fromCurrent;
  return shiftedPrior(scope, priorRows, (r) => r.salesWindow);
}

function shiftedPrior(
  scope: SituationScope,
  priorRows: readonly HistoricalItemRow[],
  pick: (row: HistoricalItemRow) => DateRange | undefined
): DateRange | undefined {
  const prior = unionRange(priorRows.map(pick));
  if (!prior) return undefined;
  const targetYear = periodYear(scope.planningPeriod);
  const priorYear = priorRows[0] ? periodYear(priorRows[0].historicalPeriod) : undefined;
  if (targetYear === undefined || priorYear === undefined) return prior;
  return shiftYears(prior, targetYear - priorYear);
}

/**
 * The runway. Only dates the data actually supports become markers — a
 * fabricated milestone would be worse than a shorter timeline.
 */
function buildRunway(
  now: string,
  productionWindow: DateRange | undefined,
  salesWindow: DateRange | undefined,
  materials: MaterialExposure,
  capacity: CapacityExposure
): DecisionRunway {
  const markers: RunwayMarker[] = [
    { kind: "today", label: "Today", date: now, weeksAway: 0, isEarliestIrreversible: false },
  ];

  if (materials.earliestDecisionDate) {
    const driver = materials.rows.find((r) => r.decisionDate === materials.earliestDecisionDate);
    markers.push({
      kind: "material_commitment",
      label: "Material commitment",
      date: materials.earliestDecisionDate,
      weeksAway: weeksBetween(now, materials.earliestDecisionDate),
      isEarliestIrreversible: false,
      detail: driver ? `${driver.materialName} · ${driver.leadTimeDays}d lead time` : undefined,
    });
  }

  // The capacity decision is the start of the first month this programme's
  // load helps push past target — after that the hours are already being
  // consumed. The same breach Decisions lists as "Resolve load on …".
  const breach = [...capacity.cells]
    .filter(breachesTarget)
    .sort((a, b) => a.period.localeCompare(b.period))[0];
  if (breach) {
    const date = `${breach.period}-01`;
    markers.push({
      kind: "capacity_decision",
      label: "Capacity decision",
      date,
      weeksAway: weeksBetween(now, date),
      isEarliestIrreversible: false,
      detail: `${breach.lineName} reaches ${Math.round(breach.effectiveUtilization * 100)}% in ${formatMonthLabel(breach.period)}`,
    });
  }

  if (productionWindow) {
    markers.push({
      kind: "production_start",
      label: "Production starts",
      date: productionWindow.start,
      weeksAway: weeksBetween(now, productionWindow.start),
      isEarliestIrreversible: false,
    });
    markers.push({
      kind: "production_end",
      label: "Production ends",
      date: productionWindow.end,
      weeksAway: weeksBetween(now, productionWindow.end),
      isEarliestIrreversible: false,
    });
  }
  if (salesWindow) {
    markers.push({
      kind: "sales_start",
      label: "Sales window opens",
      date: salesWindow.start,
      weeksAway: weeksBetween(now, salesWindow.start),
      isEarliestIrreversible: false,
    });
    markers.push({
      kind: "sales_end",
      label: "Sales window closes",
      date: salesWindow.end,
      weeksAway: weeksBetween(now, salesWindow.end),
      isEarliestIrreversible: false,
    });
  }

  markers.sort((a, b) => a.date.localeCompare(b.date));

  // "Irreversible" means a commitment, so today itself never qualifies. A
  // commitment whose date has already passed is the most urgent signal there
  // is, not one to skip over — it surfaces as overdue rather than being
  // quietly replaced by the next future milestone.
  const earliest = markers.find((m) => m.kind !== "today");
  if (earliest) earliest.isEarliestIrreversible = true;

  return {
    today: now,
    markers,
    earliest,
    weeksOfRunway: earliest ? earliest.weeksAway : undefined,
    productionWindow,
    salesWindow,
  };
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

function deriveLifecycle(bridge: ReconciliationBridge): SituationLifecycle {
  if (bridge.expectedValue === 0) return "FORMAL";
  if (bridge.representedPct >= 0.995) return "RECONCILED";
  if (bridge.representedPct >= 0.75) return "PARTIALLY_FORMALIZED";
  return "UNRESOLVED";
}

/**
 * Attention state. Runway dominates: a large gap eighteen months out is not
 * urgent, and a small one whose material commitment lands next month is.
 */
function deriveState(
  bridge: ReconciliationBridge,
  runway: DecisionRunway,
  capacity: CapacityExposure,
  lifecycle: SituationLifecycle
): SituationState {
  if (lifecycle === "RECONCILED") return "RECONCILED";
  if (bridge.unresolvedValue <= 0) return "RECONCILED";

  const weeks = runway.weeksOfRunway;
  const overdue = weeks !== undefined && weeks <= 0;
  const soon = weeks !== undefined && weeks <= 12;
  const capacityBreach = capacity.exposedLineIds.length > 0;

  if (overdue || (soon && (capacityBreach || bridge.representedPct < 0.9))) return "ACTION_NEEDED";
  if (soon || capacityBreach) return "MONITOR";
  return "FORMING";
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

function buildEvidence(
  dataset: PlanningDataset,
  scope: SituationScope,
  businessRows: readonly { targetValue: number }[],
  currentRows: readonly CurrentPlanRow[],
  priorRows: readonly HistoricalItemRow[],
  bridge: ReconciliationBridge
): SituationEvidence[] {
  const source = dataset.metadata.mode === "DEMO" ? "Demo data" : dataset.metadata.sourceFileName ?? "Your data";
  const priorPeriod = priorRows[0]?.historicalPeriod ?? "—";
  return [
    {
      id: "ev_business_plan",
      label: "Business plan rows",
      source: `${source} · Business_Plan`,
      value: `${businessRows.length}`,
      detail: `Expected ${formatCompact(bridge.expectedValue)} for ${scope.planningPeriod}`,
    },
    {
      id: "ev_current_plan",
      label: "Formal items",
      source: `${source} · Current_Plan`,
      value: `${currentRows.length}`,
      detail: `Representing ${formatCompact(bridge.formalValue)}`,
    },
    {
      id: "ev_historical",
      label: "Prior-season items",
      source: `${source} · Historical_Items`,
      value: `${priorRows.length}`,
      detail: `From ${priorPeriod}`,
    },
  ];
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${Math.round(value)}`;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
