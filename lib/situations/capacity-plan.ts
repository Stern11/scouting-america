/**
 * Capacity planning at plant → line → month grain (V2 §46, PRD §14).
 *
 * Capacity is not a property of one product or one programme. A line in June
 * carries every formal item that runs on it plus every carry-forward SKU from
 * every programme, so this reads the whole plant at once — and gets its own
 * scenario, separate from demand planning.
 *
 * Coherence: formal hours are computed with the same mapping and month-weight
 * rule as `buildSituations`, and carry-forward hours are read straight from
 * each situation's `capacityExposure` contributors, so a line-month here adds
 * up to exactly what the programmes already show. Only carry-forward bears
 * load — that rule is inherited, not re-decided.
 *
 * The levers are the capacity planner's own: variable monthly caps, an extra
 * shift, pulling carry-forward production forward, and — last — supplying less
 * of a brand × pack. Allocation is never per SKU: what sells is not a capacity
 * planner's call. Pull-forward does name SKUs, because a build that moves is a
 * specific item with specific components to order earlier.
 */

import type { ItemLineMappingRow, LineHistoryRow, MonthKey, PlanningDataset } from "@/types/dataset";
import type { MaterialPlanningStatus, PlanningSituation } from "@/types/situation";
import { addMonths, daysBetween, formatMonthLabel, monthWeights, weeksBetween, addDays } from "@/lib/dataset/periods";
import { fmtHours, fmtMoney, fmtPct, fmtUnits } from "@/lib/utils/format";
import { levelLoad, MAX_MOVE_WEEKS, type MoveDirection } from "./pull-forward";
import { lineShare } from "./build";

/* ------------------------------------------------------------------ */
/* Scenario shape                                                      */
/* ------------------------------------------------------------------ */

/** Overrides only. Every derived number is recomputed from these. */
export interface CapacityAdjustments {
  /** `${lineId}::${period}` -> available hours for that line and month. */
  availableHours: Record<string, number>;
  /** `${lineId}::${period}` -> 1 when the extra shift is on. */
  extraShifts: Record<string, number>;
  /** `${lineId}` -> weeks carry-forward builds may be pulled forward, 1..MAX_MOVE_WEEKS. */
  moveWeeks: Record<string, number>;
  /** `${brand}::${packFormat}` -> share of that brand × pack the plant supplies, 0-1. */
  allocation: Record<string, number>;
}

export type CapacityAdjustmentCategory = keyof CapacityAdjustments;

export const EMPTY_CAPACITY_ADJUSTMENTS: CapacityAdjustments = {
  availableHours: {},
  extraShifts: {},
  moveWeeks: {},
  allocation: {},
};

export interface CapacityScenario {
  id: string;
  name: string;
  adjustments: CapacityAdjustments;
  /** The last saved snapshot; `adjustments` is the draft. */
  savedAdjustments: CapacityAdjustments;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export function lineMonthKey(lineId: string, period: MonthKey): string {
  return `${lineId}::${period}`;
}

export function brandPackKey(brand: string, packFormat: string): string {
  return `${brand}::${packFormat}`;
}

export function countCapacityAdjustments(a: CapacityAdjustments): number {
  return (
    Object.keys(a.availableHours).length +
    Object.keys(a.extraShifts).length +
    Object.keys(a.moveWeeks).length +
    Object.keys(a.allocation).length
  );
}

/* ------------------------------------------------------------------ */
/* Calendar rules                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_TARGET_UTILIZATION = 0.9;

/** An extra shift is one 8-hour shift on each Saturday and Sunday of the month. */
export const EXTRA_SHIFT_HOURS = 8;

/** Months before the first loaded month that stay visible, so building earlier has somewhere to go. */
const LEAD_IN_MONTHS = 3;

function parseMonth(month: MonthKey): [number, number] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return [y, m];
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = parseMonth(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The physical ceiling: every hour of every day. A cap can never exceed it. */
export function calendarMaxHours(month: MonthKey): number {
  return daysInMonth(month) * 24;
}

export function weekendDaysIn(month: MonthKey): number {
  const [y, m] = parseMonth(month);
  let count = 0;
  for (let d = 1; d <= daysInMonth(month); d++) {
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (day === 0 || day === 6) count++;
  }
  return count;
}

/** Hours one extra shift adds in a month, before the calendar cap. */
export function extraShiftHoursFor(month: MonthKey): number {
  return weekendDaysIn(month) * EXTRA_SHIFT_HOURS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* Line history                                                        */
/* ------------------------------------------------------------------ */

export interface LineHistoryStats {
  lineId: string;
  months: number;
  avgScheduledHours: number;
  avgRunHours: number;
  /** Run ÷ scheduled, overtime included. */
  attainmentPct: number;
  avgDowntimeHours?: number;
  avgOvertimeHours?: number;
  avgLateArrivals?: number;
  avgLateArrivalHoursLost?: number;
  /**
   * Share of scheduled hours the line actually delivers: (run − overtime) ÷
   * scheduled when overtime is recorded for every month, else run ÷ scheduled.
   * Overtime is taken out because a planned cap does not include it.
   */
  deliveryPct: number;
  deliveryBasis: "without_overtime" | "including_overtime";
}

const avgOf = (rows: readonly LineHistoryRow[], pick: (r: LineHistoryRow) => number | undefined) => {
  const values = rows.map(pick).filter((v): v is number => v !== undefined);
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : undefined;
};

/** The last twelve completed months for one line, or undefined when there are none. */
/** "Last 12 months: 41h/mo unplanned downtime · 20h/mo overtime · 3 late material arrivals/mo". */
export function describeLineHistory(stats: LineHistoryStats): string {
  const parts: string[] = [];
  if (stats.avgDowntimeHours !== undefined) parts.push(`${fmtHours(stats.avgDowntimeHours)}/mo unplanned downtime`);
  if (stats.avgOvertimeHours !== undefined) parts.push(`${fmtHours(stats.avgOvertimeHours)}/mo overtime`);
  if (stats.avgLateArrivals !== undefined) {
    const n = Math.round(stats.avgLateArrivals * 10) / 10;
    parts.push(`${n} late material arrival${n === 1 ? "" : "s"}/mo`);
  }
  if (parts.length === 0) parts.push(`${fmtPct(stats.attainmentPct)} of scheduled hours run`);
  return `Last ${stats.months} month${stats.months === 1 ? "" : "s"}: ${parts.join(" · ")}`;
}

export function lineHistoryStats(
  rows: readonly LineHistoryRow[],
  lineId: string,
  nowMonth: MonthKey
): LineHistoryStats | undefined {
  const recent = rows
    .filter((r) => r.lineId === lineId && r.period < nowMonth)
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 12);
  const scheduled = recent.reduce((s, r) => s + r.scheduledHours, 0);
  if (recent.length === 0 || scheduled <= 0) return undefined;

  const run = recent.reduce((s, r) => s + r.runHours, 0);
  const overtimeKnown = recent.every((r) => r.overtimeHours !== undefined);
  const overtime = recent.reduce((s, r) => s + (r.overtimeHours ?? 0), 0);

  return {
    lineId,
    months: recent.length,
    avgScheduledHours: scheduled / recent.length,
    avgRunHours: run / recent.length,
    attainmentPct: run / scheduled,
    avgDowntimeHours: avgOf(recent, (r) => r.unplannedDowntimeHours),
    avgOvertimeHours: avgOf(recent, (r) => r.overtimeHours),
    avgLateArrivals: avgOf(recent, (r) => r.lateArrivals),
    avgLateArrivalHoursLost: avgOf(recent, (r) => r.lateArrivalHoursLost),
    deliveryPct: overtimeKnown ? Math.max(0, run - overtime) / scheduled : run / scheduled,
    deliveryBasis: overtimeKnown ? "without_overtime" : "including_overtime",
  };
}

/* ------------------------------------------------------------------ */
/* Load by brand × pack                                                */
/* ------------------------------------------------------------------ */

/**
 * Line mappings for an item, most specific level first — the same rule
 * `buildSituations` uses, so formal hours here match the situations exactly.
 */
function resolveLineMappings(
  mappings: readonly ItemLineMappingRow[],
  keys: { itemId?: string; basePack?: string; productFamily?: string }
): ItemLineMappingRow[] {
  const byLevel = (level: ItemLineMappingRow["mappingLevel"], value: string | undefined) =>
    value === undefined
      ? []
      : mappings.filter((m) => m.mappingLevel === level && m.itemOrFamilyId.toLowerCase() === value.toLowerCase());
  const item = byLevel("ITEM", keys.itemId);
  if (item.length > 0) return item;
  const basePack = byLevel("BASE_PACK", keys.basePack);
  if (basePack.length > 0) return basePack;
  return byLevel("PRODUCT_FAMILY", keys.productFamily);
}

/**
 * The formal plan carries a family, not a pack format. A family's pack is
 * read from its prior items (the most common one); with no history it falls
 * back to the family name rather than inventing a pack.
 */
function packByFamily(dataset: PlanningDataset): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of dataset.historicalItems) {
    if (!row.packFormat) continue;
    const family = row.productFamily.toLowerCase();
    const byPack = counts.get(family) ?? new Map<string, number>();
    byPack.set(row.packFormat, (byPack.get(row.packFormat) ?? 0) + 1);
    counts.set(family, byPack);
  }
  const out = new Map<string, string>();
  for (const [family, byPack] of counts) {
    const best = [...byPack.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) out.set(family, best[0]);
  }
  return out;
}

interface Slice {
  formalHours: number;
  carryForwardHours: number;
  units: number;
  value: number;
  /** False once any contributing volume had no value to read. */
  valueKnown: boolean;
}

/**
 * One programme's carry-forward SKU in one line-month — the unit pull-forward
 * moves. A product can run in more than one programme, so the key carries both.
 */
interface CarryForwardLot {
  key: string;
  situationId: string;
  candidateId: string;
  itemName: string;
  /** Did not exist in the earlier comparable seasons. */
  isNewThisSeason: boolean;
  brandPackKey: string;
  hours: number;
  /**
   * Units this SKU builds per hour on this line: its planned units on the line
   * (planned units × the line's share) over its own contributor hours on the
   * line. Undefined when there is nothing to divide by.
   */
  unitsPerHour?: number;
}

export function lotKey(situationId: string, candidateId: string): string {
  return `${situationId}::${candidateId}`;
}

interface BrandPackAcc {
  brand: string;
  packFormat: string;
  byLineMonth: Map<string, Slice>;
}

function sliceFor(acc: Map<string, BrandPackAcc>, brand: string, packFormat: string, key: string): Slice {
  const bpKey = brandPackKey(brand, packFormat);
  let bp = acc.get(bpKey);
  if (!bp) {
    bp = { brand, packFormat, byLineMonth: new Map() };
    acc.set(bpKey, bp);
  }
  let slice = bp.byLineMonth.get(key);
  if (!slice) {
    slice = { formalHours: 0, carryForwardHours: 0, units: 0, value: 0, valueKnown: true };
    bp.byLineMonth.set(key, slice);
  }
  return slice;
}

function accumulateLoad(dataset: PlanningDataset, situations: readonly PlanningSituation[]) {
  const acc = new Map<string, BrandPackAcc>();
  const lots = new Map<string, CarryForwardLot[]>();
  const packs = packByFamily(dataset);

  // Formal: every item in the formal plan, across all programmes, counted once.
  for (const item of dataset.currentPlanItems) {
    const mappings = resolveLineMappings(dataset.itemLineMappings, {
      itemId: item.itemId,
      productFamily: item.productFamily,
    });
    if (mappings.length === 0 || !item.productionWindow) continue;
    const pack = packs.get(item.productFamily.toLowerCase()) ?? item.productFamily;
    const weights = monthWeights(item.productionWindow);
    for (const mapping of mappings) {
      const share = lineShare(mapping, mappings);
      const hours = (item.plannedUnits * share) / mapping.runRateUnitsPerHour;
      for (const [month, weight] of weights) {
        const key = lineMonthKey(mapping.lineId, month);
        const slice = sliceFor(acc, item.brand, pack, key);
        slice.formalHours += hours * weight;
        slice.units += item.plannedUnits * share * weight;
        if (item.plannedValue === undefined) slice.valueKnown = false;
        else slice.value += item.plannedValue * share * weight;
      }
    }
  }

  // Carry-forward: read from what each programme already computed.
  let unmappedCarryForwardUnits = 0;
  for (const situation of situations) {
    const exposure = situation.capacityExposure;
    unmappedCarryForwardUnits += exposure.unmappedItems.reduce((s, u) => s + u.units, 0);
    const totalByCandidate = new Map<string, number>();
    const byCandidateLine = new Map<string, number>();
    for (const cell of exposure.cells) {
      for (const c of cell.contributors) {
        totalByCandidate.set(c.candidateId, (totalByCandidate.get(c.candidateId) ?? 0) + c.hours);
        const cl = `${c.candidateId}::${cell.lineId}`;
        byCandidateLine.set(cl, (byCandidateLine.get(cl) ?? 0) + c.hours);
      }
    }
    const candidates = new Map(situation.candidateItems.map((c) => [c.id, c]));
    for (const cell of exposure.cells) {
      for (const contributor of cell.contributors) {
        const candidate = candidates.get(contributor.candidateId);
        const total = totalByCandidate.get(contributor.candidateId) ?? 0;
        if (!candidate || total <= 0) continue;
        const pack =
          candidate.packFormat ?? packs.get(candidate.productFamily.toLowerCase()) ?? candidate.productFamily;
        const key = lineMonthKey(cell.lineId, cell.period);
        const slice = sliceFor(acc, candidate.brand, pack, key);
        const portion = contributor.hours / total;
        slice.carryForwardHours += contributor.hours;
        slice.units += candidate.plannedUnits * portion;
        slice.value += candidate.plannedValue * portion;

        const mappings = resolveLineMappings(dataset.itemLineMappings, {
          itemId: candidate.itemId,
          basePack: candidate.basePack,
          productFamily: candidate.productFamily,
        });
        const mapping = mappings.find((m) => m.lineId === cell.lineId);
        const hoursOnLine = byCandidateLine.get(`${candidate.id}::${cell.lineId}`) ?? 0;
        const unitsOnLine = mapping ? candidate.plannedUnits * lineShare(mapping, mappings) : undefined;
        const list = lots.get(key) ?? [];
        list.push({
          key: lotKey(situation.id, candidate.id),
          situationId: situation.id,
          candidateId: candidate.id,
          itemName: candidate.itemName,
          isNewThisSeason: candidate.isNewThisSeason,
          brandPackKey: brandPackKey(candidate.brand, pack),
          hours: contributor.hours,
          unitsPerHour: unitsOnLine !== undefined && hoursOnLine > 0 ? unitsOnLine / hoursOnLine : undefined,
        });
        lots.set(key, list);
      }
    }
  }

  return { acc, lots, unmappedCarryForwardUnits };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export interface CapacityPlanCell {
  lineId: string;
  period: MonthKey;
  calendarMaxHours: number;
  targetUtilizationPct: number;
  /** From Line_Capacity. */
  baselineAvailableHours: number;
  /** The planner's cap, or the baseline. */
  plannedAvailableHours: number;
  /** Added by the extra-shift toggle, after the calendar cap. */
  extraShiftHours: number;
  extraShiftOn: boolean;
  /** planned + extra shift. */
  availableHours: number;
  /** After brand × pack allocation. */
  formalHours: number;
  carryForwardHours: number;
  /** formal + carry-forward, before any move. */
  loadHours: number;
  /** Units behind `loadHours`, after allocation. */
  units: number;
  /** Carry-forward hours whose build was pulled into an earlier month. */
  movedOutHours: number;
  /** Carry-forward hours pulled into this month from later months. */
  movedInHours: number;
  /** What the line actually runs this month after moving production. */
  loadAfterHours: number;
  /** loadAfter ÷ available. Infinity when a loaded month has no hours. */
  utilization: number;
  overCapacityHours: number;
  overTarget: boolean;
}

export interface CapacityPlanLine {
  lineId: string;
  lineName: string;
  plant: string;
  cells: CapacityPlanCell[];
  moveWeeks: number;
  moveDirection: MoveDirection;
  movedHours: number;
  /** Every SKU build pulled forward, from its planned month to where it is built. */
  moves: CapacityMove[];
  overCapacityHours: number;
  peakUtilization: number;
  overTarget: boolean;
  history?: LineHistoryStats;
  /** Mean available hours per month across the horizon. */
  avgAvailableHours: number;
}

/** One SKU's build pulled forward on one line. */
export interface CapacityMove {
  candidateId: string;
  itemName: string;
  isNewThisSeason: boolean;
  situationId: string;
  fromPeriod: MonthKey;
  toPeriod: MonthKey;
  hours: number;
  /** hours × the SKU's units per hour on this line; undefined when that rate is unknown. */
  units?: number;
}

export interface BrandPackLoad {
  key: string;
  brand: string;
  packFormat: string;
  /** 0-1; 1 when untouched. */
  allocationPct: number;
  formalHours: number;
  carryForwardHours: number;
  totalHours: number;
  hoursFreed: number;
  units: number;
  unitsNotSupplied: number;
  value: number;
  revenueAtRisk: number;
  /** False when some formal volume had no planned value — revenue is then a floor. */
  valueComplete: boolean;
}

export interface CapacityPlanSummary {
  overCapacityHours: number;
  linesOverTarget: number;
  peak?: { lineId: string; lineName: string; period: MonthKey; utilization: number };
  extraShiftHours: number;
  /** Net hours added or removed by edited caps. */
  capChangeHours: number;
  movedHours: number;
  unitsNotSupplied: number;
  revenueAtRisk: number;
}

export interface CapacityPlan {
  available: boolean;
  unavailableReason?: string;
  plants: string[];
  plant?: string;
  periods: MonthKey[];
  lines: CapacityPlanLine[];
  brandPacks: BrandPackLoad[];
  summary: CapacityPlanSummary;
  /** Carry-forward units no line mapping can place — reported, never dropped silently. */
  unmappedCarryForwardUnits: number;
  historyAvailable: boolean;
}

const EMPTY_SUMMARY: CapacityPlanSummary = {
  overCapacityHours: 0,
  linesOverTarget: 0,
  extraShiftHours: 0,
  capChangeHours: 0,
  movedHours: 0,
  unitsNotSupplied: 0,
  revenueAtRisk: 0,
};

export function buildCapacityPlan(
  dataset: PlanningDataset,
  situations: readonly PlanningSituation[],
  adjustments: CapacityAdjustments = EMPTY_CAPACITY_ADJUSTMENTS,
  plant?: string
): CapacityPlan {
  const plants = [...new Set(dataset.lineCapacity.map((r) => r.plant))].sort();
  const historyAvailable = dataset.metadata.capabilities.lineHistory && dataset.lineHistory.length > 0;
  const empty = (reason: string, chosen?: string): CapacityPlan => ({
    available: false,
    unavailableReason: reason,
    plants,
    plant: chosen,
    periods: [],
    lines: [],
    brandPacks: [],
    summary: EMPTY_SUMMARY,
    unmappedCarryForwardUnits: 0,
    historyAvailable,
  });

  if (dataset.lineCapacity.length === 0) return empty("Add Line_Capacity data to plan capacity.");
  if (dataset.itemLineMappings.length === 0) {
    return empty("Add Item_Line_Mapping data to convert units into line hours.");
  }

  const chosenPlant = plant && plants.includes(plant) ? plant : plants[0]!;
  const nowMonth = dataset.metadata.planningNow.slice(0, 7);
  const capacityRows = dataset.lineCapacity.filter((r) => r.plant === chosenPlant && r.period >= nowMonth);
  const rowByKey = new Map(capacityRows.map((r) => [lineMonthKey(r.lineId, r.period), r]));
  const lineIds = [...new Set(capacityRows.map((r) => r.lineId))].sort();

  const { acc, lots, unmappedCarryForwardUnits } = accumulateLoad(dataset, situations);

  // Horizon: the months that carry load on this plant, plus a short lead-in.
  const loadByKey = new Map<string, number>();
  for (const bp of acc.values()) {
    for (const [key, slice] of bp.byLineMonth) {
      if (!rowByKey.has(key)) continue;
      loadByKey.set(key, (loadByKey.get(key) ?? 0) + slice.formalHours + slice.carryForwardHours);
    }
  }
  const loadedMonths = [...new Set([...loadByKey].filter(([, h]) => h > 0.5).map(([k]) => k.split("::")[1]!))].sort();
  if (loadedMonths.length === 0) {
    return { ...empty("Nothing is planned on this plant's lines yet.", chosenPlant), unmappedCarryForwardUnits };
  }
  const firstMonth = addMonths(loadedMonths[0]!, -LEAD_IN_MONTHS);
  const lastMonth = loadedMonths[loadedMonths.length - 1]!;
  const periods = [...new Set(capacityRows.map((r) => r.period))]
    .filter((p) => p >= firstMonth && p <= lastMonth)
    .sort();

  const allocationOf = (key: string) => clamp(adjustments.allocation[key] ?? 1, 0, 1);

  const lines: CapacityPlanLine[] = [];
  for (const lineId of lineIds) {
    const history = historyAvailable ? lineHistoryStats(dataset.lineHistory, lineId, nowMonth) : undefined;
    const weeks = clamp(adjustments.moveWeeks[lineId] ?? 0, 0, MAX_MOVE_WEEKS);

    const draft = periods.flatMap((period) => {
      const key = lineMonthKey(lineId, period);
      const row = rowByKey.get(key);
      if (!row) return [];
      const calMax = calendarMaxHours(period);
      const override = adjustments.availableHours[key];
      const planned = override === undefined ? row.availableHours : clamp(override, 0, calMax);
      const shiftOn = (adjustments.extraShifts[key] ?? 0) > 0;
      const extra = shiftOn ? Math.max(0, Math.min(extraShiftHoursFor(period), calMax - planned)) : 0;

      let formal = 0;
      let carry = 0;
      let units = 0;
      for (const [bpKey, bp] of acc) {
        const slice = bp.byLineMonth.get(key);
        if (!slice) continue;
        const share = allocationOf(bpKey);
        formal += slice.formalHours * share;
        carry += slice.carryForwardHours * share;
        units += slice.units * share;
      }
      // The SKUs behind `carry`, scaled by the same allocation, so they add up to it.
      const monthLots = (lots.get(key) ?? [])
        .map((lot) => ({ ...lot, hours: lot.hours * allocationOf(lot.brandPackKey) }))
        .filter((lot) => lot.hours > 0);
      return [{ row, period, calMax, planned, shiftOn, extra, formal, carry, units, lots: monthLots }];
    });

    const levelled = levelLoad(
      draft.map((d) => ({
        period: d.period,
        fixedHours: d.formal,
        lots: d.lots.map((l) => ({ key: l.key, hours: l.hours })),
        availableHours: d.planned + d.extra,
      })),
      weeks,
      { earliestPeriod: nowMonth }
    );

    const lotInfo = new Map<string, CarryForwardLot>();
    for (const d of draft) {
      for (const lot of d.lots) {
        // A SKU's rate on a line is the same every month; keep the first seen.
        if (!lotInfo.has(`${lot.key}@${d.period}`)) lotInfo.set(`${lot.key}@${d.period}`, lot);
      }
    }
    const moves: CapacityMove[] = levelled.moves.map((move) => {
      const lot = lotInfo.get(`${move.key}@${move.from}`);
      return {
        candidateId: lot?.candidateId ?? move.key,
        itemName: lot?.itemName ?? move.key,
        isNewThisSeason: lot?.isNewThisSeason ?? false,
        situationId: lot?.situationId ?? "",
        fromPeriod: move.from,
        toPeriod: move.to,
        hours: move.hours,
        units: lot?.unitsPerHour !== undefined ? move.hours * lot.unitsPerHour : undefined,
      };
    });

    const cells: CapacityPlanCell[] = draft.map((d, i) => {
      const lv = levelled.months[i]!;
      const available = d.planned + d.extra;
      const target = d.row.targetUtilizationPct ?? DEFAULT_TARGET_UTILIZATION;
      const utilization = available > 0 ? lv.loadAfterHours / available : lv.loadAfterHours > 0.5 ? Infinity : 0;
      return {
        lineId,
        period: d.period,
        calendarMaxHours: d.calMax,
        targetUtilizationPct: target,
        baselineAvailableHours: d.row.availableHours,
        plannedAvailableHours: d.planned,
        extraShiftHours: d.extra,
        extraShiftOn: d.shiftOn,
        availableHours: available,
        formalHours: d.formal,
        carryForwardHours: d.carry,
        loadHours: d.formal + d.carry,
        units: d.units,
        movedOutHours: lv.movedOutHours,
        movedInHours: lv.movedInHours,
        loadAfterHours: lv.loadAfterHours,
        utilization,
        overCapacityHours: lv.overflowAfterHours,
        overTarget: utilization > target + 1e-9,
      };
    });

    const first = draft[0]?.row;
    if (!first) continue;
    lines.push({
      lineId,
      lineName: first.lineName,
      plant: first.plant,
      cells,
      moveWeeks: weeks,
      moveDirection: levelled.direction,
      movedHours: levelled.totalMovedHours,
      moves,
      overCapacityHours: levelled.totalOverflowAfterHours,
      peakUtilization: cells.reduce((max, c) => Math.max(max, c.utilization), 0),
      overTarget: cells.some((c) => c.overTarget),
      history,
      avgAvailableHours: cells.length > 0 ? cells.reduce((s, c) => s + c.availableHours, 0) / cells.length : 0,
    });
  }

  const inHorizon = new Set(lines.flatMap((l) => l.cells.map((c) => lineMonthKey(c.lineId, c.period))));
  const brandPacks: BrandPackLoad[] = [];
  for (const [key, bp] of acc) {
    let formalHours = 0;
    let carryForwardHours = 0;
    let units = 0;
    let value = 0;
    let valueComplete = true;
    for (const [lm, slice] of bp.byLineMonth) {
      if (!inHorizon.has(lm)) continue;
      formalHours += slice.formalHours;
      carryForwardHours += slice.carryForwardHours;
      units += slice.units;
      value += slice.value;
      if (!slice.valueKnown) valueComplete = false;
    }
    const totalHours = formalHours + carryForwardHours;
    if (totalHours <= 0.5) continue;
    const share = allocationOf(key);
    brandPacks.push({
      key,
      brand: bp.brand,
      packFormat: bp.packFormat,
      allocationPct: share,
      formalHours,
      carryForwardHours,
      totalHours,
      hoursFreed: totalHours * (1 - share),
      units,
      unitsNotSupplied: units * (1 - share),
      value,
      revenueAtRisk: value * (1 - share),
      valueComplete,
    });
  }
  brandPacks.sort((a, b) => b.totalHours - a.totalHours);

  const allCells = lines.flatMap((l) => l.cells.map((c) => ({ line: l, cell: c })));
  const peak = allCells.reduce<{ line: CapacityPlanLine; cell: CapacityPlanCell } | undefined>(
    (worst, x) => (worst === undefined || x.cell.utilization > worst.cell.utilization ? x : worst),
    undefined
  );

  return {
    available: true,
    plants,
    plant: chosenPlant,
    periods,
    lines,
    brandPacks,
    summary: {
      overCapacityHours: lines.reduce((s, l) => s + l.overCapacityHours, 0),
      linesOverTarget: lines.filter((l) => l.overTarget).length,
      peak: peak
        ? {
            lineId: peak.line.lineId,
            lineName: peak.line.lineName,
            period: peak.cell.period,
            utilization: peak.cell.utilization,
          }
        : undefined,
      extraShiftHours: allCells.reduce((s, x) => s + x.cell.extraShiftHours, 0),
      capChangeHours: allCells.reduce((s, x) => s + x.cell.plannedAvailableHours - x.cell.baselineAvailableHours, 0),
      movedHours: lines.reduce((s, l) => s + l.movedHours, 0),
      unitsNotSupplied: brandPacks.reduce((s, b) => s + b.unitsNotSupplied, 0),
      revenueAtRisk: brandPacks.reduce((s, b) => s + b.revenueAtRisk, 0),
    },
    unmappedCarryForwardUnits,
    historyAvailable,
  };
}

/* ------------------------------------------------------------------ */
/* What changed                                                        */
/* ------------------------------------------------------------------ */

export interface CapacityChange {
  category: CapacityAdjustmentCategory;
  key: string;
  label: string;
  detail: string;
}

/** "Line 03 — High-Speed Bagging" -> "Line 03". */
export function shortLineName(lineName: string): string {
  return lineName.split(" — ")[0] ?? lineName;
}

/**
 * One row per lever the planner has actually moved, described against the
 * plan it produces. A lever set back to its baseline is not a change.
 */
export function describeCapacityChanges(
  plan: CapacityPlan,
  adjustments: CapacityAdjustments,
  currency = "USD"
): CapacityChange[] {
  const changes: CapacityChange[] = [];

  for (const line of plan.lines) {
    const name = shortLineName(line.lineName);
    for (const cell of line.cells) {
      const key = lineMonthKey(line.lineId, cell.period);
      const month = formatMonthLabel(cell.period);
      if (
        adjustments.availableHours[key] !== undefined &&
        Math.abs(cell.plannedAvailableHours - cell.baselineAvailableHours) >= 0.5
      ) {
        changes.push({
          category: "availableHours",
          key,
          label: `${name} · ${month} cap`,
          detail: `${fmtHours(cell.baselineAvailableHours)} → ${fmtHours(cell.plannedAvailableHours)}`,
        });
      }
      if (cell.extraShiftOn) {
        changes.push({
          category: "extraShifts",
          key,
          label: `${name} · ${month} extra shift`,
          detail: `+${fmtHours(cell.extraShiftHours)}`,
        });
      }
    }
    if (line.moveWeeks > 0) {
      changes.push({
        category: "moveWeeks",
        key: line.lineId,
        label: `${name} · pull forward up to ${line.moveWeeks} wks`,
        detail: `${fmtHours(line.movedHours)} built earlier`,
      });
    }
  }

  for (const bp of plan.brandPacks) {
    if (bp.allocationPct >= 0.9995) continue;
    changes.push({
      category: "allocation",
      key: bp.key,
      label: `${bp.brand} · ${bp.packFormat} supplied at ${fmtPct(bp.allocationPct)}`,
      detail: `−${fmtUnits(bp.unitsNotSupplied, true)} · ${fmtMoney(bp.revenueAtRisk, currency)} at risk`,
    });
  }

  return changes;
}

/* ------------------------------------------------------------------ */
/* One line, for the chart and the focused month                       */
/* ------------------------------------------------------------------ */

export function fmtUtilization(value: number): string {
  return Number.isFinite(value) ? fmtPct(value) : "No hours";
}

/**
 * The line's months as chart bars. Formal load never moves, so committed is
 * the formal plan; added is the carry-forward still built in the month; moved
 * in is carry-forward pulled in from later months. For a line with no
 * scenario that is formal, carry-forward and zero — the Overview's hours.
 */
export function lineChartMonths(line: CapacityPlanLine): {
  period: MonthKey;
  committedHours: number;
  addedHours: number;
  movedInHours: number;
  capacityHours: number;
  /** The planner changed this month's cap or added a shift. */
  capacityEdited: boolean;
}[] {
  return line.cells.map((c) => ({
    period: c.period,
    committedHours: c.formalHours,
    addedHours: Math.max(0, c.carryForwardHours - c.movedOutHours),
    movedInHours: c.movedInHours,
    capacityHours: c.availableHours,
    capacityEdited: isCapacityEdited(c),
  }));
}

/** A cap that differs from Line_Capacity, or an extra shift. */
export function isCapacityEdited(cell: CapacityPlanCell): boolean {
  return Math.abs(cell.plannedAvailableHours - cell.baselineAvailableHours) >= 0.5 || cell.extraShiftHours > 0.5;
}

/* ------------------------------------------------------------------ */
/* Typing a month's cap                                                */
/* ------------------------------------------------------------------ */

export type CapacityEntry =
  /** Nothing to write: blank, unparseable, or the value already in force. */
  | { kind: "unchanged" }
  /** Back to Line_Capacity — clear the override rather than store the baseline. */
  | { kind: "reset" }
  | { kind: "set"; hours: number }
  /** Below what the formal plan alone needs that month: ask before writing. */
  | { kind: "confirm"; hours: number };

/**
 * What typing `text` into a month's cap box should do. Blank is never zero —
 * clearing the box and clicking away used to write a 0h month. A value below
 * the month's formal load is almost always a slip (a half-typed "43" for
 * "433"), so it needs a confirm instead of landing silently.
 */
export function resolveCapacityEntry(
  text: string,
  cell: Pick<CapacityPlanCell, "plannedAvailableHours" | "baselineAvailableHours" | "calendarMaxHours" | "formalHours">
): CapacityEntry {
  const trimmed = text.trim().replace(/,/g, "").replace(/h$/i, "").trim();
  if (trimmed === "") return { kind: "unchanged" };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { kind: "unchanged" };
  const hours = Math.round(clamp(parsed, 0, cell.calendarMaxHours));
  if (hours === Math.round(cell.plannedAvailableHours)) return { kind: "unchanged" };
  if (hours === Math.round(cell.baselineAvailableHours)) return { kind: "reset" };
  if (hours < cell.formalHours - 0.5) return { kind: "confirm", hours };
  return { kind: "set", hours };
}

/** The month most over capacity; failing that, the highest utilisation. */
export function worstPeriod(line: CapacityPlanLine): MonthKey | undefined {
  let worst: CapacityPlanCell | undefined;
  for (const c of line.cells) {
    if (
      !worst ||
      c.overCapacityHours > worst.overCapacityHours + 1e-9 ||
      (Math.abs(c.overCapacityHours - worst.overCapacityHours) <= 1e-9 && c.utilization > worst.utilization)
    ) {
      worst = c;
    }
  }
  return worst?.period;
}

export interface FocusMonth {
  period: MonthKey;
  overflowBeforeHours: number;
  overflowAfterHours: number;
  /** Overflow as a share of that month's available hours. */
  overflowBeforePct: number;
  overflowAfterPct: number;
  /** Carry-forward hours whose build was pulled out of this month. */
  movedHours: number;
  /** Carry-forward hours pulled into this month from later months. */
  movedInHours: number;
  direction: MoveDirection;
  /** Overflow no longer over capacity, from any lever. */
  hoursResolved: number;
  /**
   * Units whose build now fits: hours resolved by pulling forward are priced
   * at the moved SKUs' own rates, any rest (caps, shifts) at the month's
   * average. Undefined with nothing to price.
   */
  unitsSecured?: number;
}

/**
 * The four tiles for one month: overflow before → shown, hours pulled
 * forward, hours still over, units secured. `before` is the line with no
 * scenario; `shown` is whichever line the chart is showing — pass `before`
 * again for the Before view and every figure reads as unchanged.
 */
export function focusMonth(
  before: CapacityPlanLine,
  shown: CapacityPlanLine,
  period: MonthKey
): FocusMonth | undefined {
  const b = before.cells.find((c) => c.period === period);
  const a = shown.cells.find((c) => c.period === period);
  if (!b || !a) return undefined;
  const hoursResolved = Math.max(0, b.overCapacityHours - a.overCapacityHours);

  const out = shown.moves.filter((m) => m.fromPeriod === period);
  const outHours = out.reduce((s, m) => s + m.hours, 0);
  const outUnitsKnown = out.every((m) => m.units !== undefined);
  const outUnits = out.reduce((s, m) => s + (m.units ?? 0), 0);
  const avgRate = b.loadHours > 0 ? b.units / b.loadHours : undefined;

  const byMoves = Math.min(hoursResolved, outHours);
  const byOther = hoursResolved - byMoves;
  let unitsSecured: number | undefined;
  if (hoursResolved <= 0) unitsSecured = avgRate !== undefined ? 0 : undefined;
  else if ((byMoves > 0 && !outUnitsKnown) || (byOther > 0 && avgRate === undefined)) unitsSecured = undefined;
  else unitsSecured = (outHours > 0 ? outUnits * (byMoves / outHours) : 0) + (avgRate ?? 0) * byOther;

  return {
    period,
    overflowBeforeHours: b.overCapacityHours,
    overflowAfterHours: a.overCapacityHours,
    overflowBeforePct: b.availableHours > 0 ? b.overCapacityHours / b.availableHours : 0,
    overflowAfterPct: a.availableHours > 0 ? a.overCapacityHours / a.availableHours : 0,
    movedHours: a.movedOutHours,
    movedInHours: a.movedInHours,
    direction: a.movedOutHours > 0.5 ? shown.moveDirection : "none",
    hoursResolved,
    unitsSecured,
  };
}

/* ------------------------------------------------------------------ */
/* Pull-forward plan for one month: SKUs and what to order by when     */
/* ------------------------------------------------------------------ */

export type ProcurementUrgency = "critical" | "warning" | "positive";

/** Overdue or within 8 weeks is critical; within 20 a warning. */
export function procurementUrgency(weeksLeft: number): ProcurementUrgency {
  if (weeksLeft <= 8) return "critical";
  if (weeksLeft <= 20) return "warning";
  return "positive";
}

export interface PullForwardComponent {
  materialId: string;
  materialName: string;
  componentType: string;
  uom: string;
  /** Per-unit requirement for this SKU × the units moved. */
  quantity: number;
  status: MaterialPlanningStatus;
  /** The order-by date before the move. */
  wasOrderBy: string;
  /** Moved earlier by the same number of days the build moved. */
  orderBy: string;
  /** Whole weeks from planningNow to `orderBy`; negative is overdue. */
  weeksLeft: number;
  urgency: ProcurementUrgency;
  /** Set for WAIT components: they cannot be ordered yet, whatever the date says. */
  waitNote?: string;
}

export interface PullForwardSku {
  situationId: string;
  programme: string;
  candidateId: string;
  itemName: string;
  isNewThisSeason: boolean;
  fromPeriod: MonthKey;
  toPeriod: MonthKey;
  /** Whether this build leaves the month in question or arrives in it. */
  direction: "out" | "in";
  hours: number;
  units?: number;
  /** Days earlier the build (and so every order) moves. */
  shiftDays: number;
  components: PullForwardComponent[];
  /** Why there are no components to show, when there are none. */
  componentsNote?: string;
}

export interface PullForwardMonthPlan {
  period: MonthKey;
  skus: PullForwardSku[];
  committedHours: number;
  carryForwardHours: number;
  capacityHours: number;
}

const monthStart = (period: MonthKey) => `${period}-01`;

/**
 * Every pull-forward move touching `period` on a line — builds leaving it and
 * builds arriving in it — with the components each moved build needs and the
 * new order-by dates. A component's order-by date moves earlier by exactly
 * the days its build moved (month start to month start), since lead time does
 * not change when production does. Quantities come from the programme's own
 * material exposure: the SKU's requirement ÷ its units × units moved.
 */
export function pullForwardPlanForMonth(
  line: CapacityPlanLine,
  period: MonthKey,
  situations: readonly PlanningSituation[],
  planningNow: string
): PullForwardMonthPlan | undefined {
  const cell = line.cells.find((c) => c.period === period);
  if (!cell) return undefined;
  const byId = new Map(situations.map((s) => [s.id, s]));

  const skus: PullForwardSku[] = line.moves
    .filter((m) => m.fromPeriod === period || m.toPeriod === period)
    .map((move) => {
      const situation = byId.get(move.situationId);
      const shiftDays = daysBetween(monthStart(move.toPeriod), monthStart(move.fromPeriod));
      const base = {
        situationId: move.situationId,
        programme: situation?.title ?? "Unknown programme",
        candidateId: move.candidateId,
        itemName: move.itemName,
        isNewThisSeason: move.isNewThisSeason,
        fromPeriod: move.fromPeriod,
        toPeriod: move.toPeriod,
        direction: move.fromPeriod === period ? ("out" as const) : ("in" as const),
        hours: move.hours,
        units: move.units,
        shiftDays,
      };
      if (!situation) return { ...base, components: [], componentsNote: "Programme not found." };
      const exposure = situation.materialExposure;
      if (!exposure.available) {
        return { ...base, components: [], componentsNote: exposure.unavailableReason ?? "Add BOM data to see components." };
      }
      if (move.units === undefined) {
        return { ...base, components: [], componentsNote: "No run rate for this SKU on this line, so units cannot be priced." };
      }
      const components: PullForwardComponent[] = [];
      for (const row of exposure.rows) {
        const contributor = row.contributors.find((c) => c.candidateId === move.candidateId);
        if (!contributor || contributor.units <= 0) continue;
        const orderBy = addDays(row.decisionDate, -shiftDays);
        const weeksLeft = weeksBetween(planningNow, orderBy);
        components.push({
          materialId: row.materialId,
          materialName: row.materialName,
          componentType: row.componentType,
          uom: row.uom,
          quantity: (contributor.requirement / contributor.units) * move.units,
          status: row.status,
          wasOrderBy: row.decisionDate,
          orderBy,
          weeksLeft,
          urgency: procurementUrgency(weeksLeft),
          waitNote: row.status === "WAIT" ? `${row.reason.replace(/[.\s]+$/, "")} — can't be ordered yet` : undefined,
        });
      }
      components.sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.materialName.localeCompare(b.materialName));
      return {
        ...base,
        components,
        componentsNote: components.length === 0 ? "No BOM for this SKU — components unknown." : undefined,
      };
    })
    // Keys a lever cannot change: hours would re-sort the list under the
    // planner every time the slider or a cap moves.
    .sort(
      (a, b) =>
        (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1) ||
        a.itemName.localeCompare(b.itemName) ||
        a.programme.localeCompare(b.programme) ||
        a.fromPeriod.localeCompare(b.fromPeriod) ||
        a.toPeriod.localeCompare(b.toPeriod)
    );

  return {
    period,
    skus,
    committedHours: cell.formalHours,
    carryForwardHours: cell.carryForwardHours,
    capacityHours: cell.availableHours,
  };
}
