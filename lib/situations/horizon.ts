/**
 * The rolling planning horizon behind Overview's missing-items timeline.
 *
 * Planning happens month by month over a rolling six-to-nine-month window, not
 * against one season total. This phases each programme onto the months it
 * *produces* in — production timing is what drives line hours and material
 * orders — and splits every month into what is planned today and what is not.
 *
 * Phasing rule: a programme's money and units land in a month in proportion to
 * the days its production window spends there (`monthWeights`, the same split
 * `build.ts` uses to place hours). Items are not divisible, so an item counts
 * in every month its programme produces in. There is no year-round baseline in
 * the data, so none is invented: a month with no production carries nothing.
 *
 * Pure: no React.
 */

import { monthWeights } from "@/lib/dataset/periods";
import type { MonthKey } from "@/types/dataset";
import type { ContributorDisposition, PlanningSituation } from "@/types/situation";

export type HorizonMeasure = "items" | "units" | "value";

/** One month's (or the whole horizon's) bar, bottom to top. */
export interface HorizonStack {
  /** In the formal plan today. */
  planned: number;
  /** Absent from the plan, accepted as carrying forward — the only load-bearing part. */
  carryingForward: number;
  /** Absent from the plan, not decided yet. Counts as nothing downstream. */
  toDecide: number;
  /** Expected business no prior item accounts for. Always zero for items. */
  unexplained: number;
  /** Absent on purpose. Shown, never counted as missing. */
  exited: number;
}

export interface HorizonSlice {
  items: HorizonStack;
  units: HorizonStack;
  /** All zero when programmes are planned in more than one currency. */
  value: HorizonStack;
  /** Expected minus formal — demand with no item in the plan. */
  missingUnits: number;
  missingValue: number;
  /** Programmes producing in this slice. */
  situationIds: string[];
}

export interface HorizonMonth extends HorizonSlice {
  period: MonthKey;
}

export interface PlanningHorizon {
  /** Months that carry any production, in order. */
  months: HorizonMonth[];
  /** The whole horizon. Items are counted once, not once per month. */
  total: HorizonSlice;
  currency: string;
  valuesComparable: boolean;
  /** Programmes with no production window, so they cannot be placed in a month. */
  unphased: { situationId: string; title: string }[];
}

const UNDECIDED: readonly ContributorDisposition[] = ["unreviewed", "under_review", "new_or_changed"];

export function isUndecided(disposition: ContributorDisposition): boolean {
  return UNDECIDED.includes(disposition);
}

/** Items the plan should have and does not: carrying forward plus still to decide. */
export function missingItems(slice: HorizonSlice): number {
  return slice.items.carryingForward + slice.items.toDecide;
}

/** Everything the season expects, including deliberate exits. */
export function expectedItems(slice: HorizonSlice): number {
  const i = slice.items;
  return i.planned + i.carryingForward + i.toDecide + i.exited;
}

/** One programme's SKUs, counted the way every page counts them. */
export interface SkuCounts {
  /** `carry_forward` — the only load-bearing disposition. */
  carryingForward: number;
  /** Not decided: unreviewed, under review, or flagged new/changed. */
  toDecide: number;
  /** What the plan should have and does not: carrying forward plus to decide. */
  missing: number;
  /** Absent on purpose. Never counted as missing. */
  exited: number;
  carryingUnits: number;
  carryingValue: number;
  toDecideUnits: number;
  toDecideValue: number;
}

/**
 * The single definition of "missing", "carrying forward" and "to decide".
 *
 * Counted by the planner's disposition, not by match status — the same rule
 * the bridge uses. A matched item the planner carries forward bears load (it
 * is in `validatedUnits`), so it is carrying forward; an unmatched item the
 * planner says is already represented is not missing. Counting by match
 * status instead made the Overview headline, Reconcile and Decisions disagree
 * the moment a planner overrode a proposal.
 */
export function skuCounts(situation: PlanningSituation): SkuCounts {
  const out: SkuCounts = {
    carryingForward: 0,
    toDecide: 0,
    missing: 0,
    exited: 0,
    carryingUnits: 0,
    carryingValue: 0,
    toDecideUnits: 0,
    toDecideValue: 0,
  };
  for (const c of situation.candidateItems) {
    if (c.disposition === "carry_forward") {
      out.carryingForward++;
      out.carryingUnits += c.plannedUnits;
      out.carryingValue += c.plannedValue;
    } else if (isUndecided(c.disposition)) {
      out.toDecide++;
      out.toDecideUnits += c.plannedUnits;
      out.toDecideValue += c.plannedValue;
    } else if (c.disposition === "intentional_exit") {
      out.exited++;
    }
  }
  out.missing = out.carryingForward + out.toDecide;
  return out;
}

export function stackTotal(stack: HorizonStack): number {
  return stack.planned + stack.carryingForward + stack.toDecide + stack.unexplained + stack.exited;
}

function emptyStack(): HorizonStack {
  return { planned: 0, carryingForward: 0, toDecide: 0, unexplained: 0, exited: 0 };
}

function emptySlice(): HorizonSlice {
  return {
    items: emptyStack(),
    units: emptyStack(),
    value: emptyStack(),
    missingUnits: 0,
    missingValue: 0,
    situationIds: [],
  };
}

function addStack(into: HorizonStack, from: HorizonStack): void {
  into.planned += from.planned;
  into.carryingForward += from.carryingForward;
  into.toDecide += from.toDecide;
  into.unexplained += from.unexplained;
  into.exited += from.exited;
}

function addSlice(into: HorizonSlice, from: HorizonSlice): void {
  addStack(into.items, from.items);
  addStack(into.units, from.units);
  addStack(into.value, from.value);
  into.missingUnits += from.missingUnits;
  into.missingValue += from.missingValue;
  into.situationIds.push(...from.situationIds);
}

/**
 * One programme at one month's weight.
 *
 * Carrying forward is the bridge's validated figure — the one number every
 * downstream page reads. Items are classed by disposition (`skuCounts`), the
 * same rule the bridge uses, so the headline cannot disagree with Reconcile.
 */
function situationSlice(s: PlanningSituation, weight: number, valuesComparable: boolean): HorizonSlice {
  const b = s.bridge;
  const slice = emptySlice();
  slice.situationIds.push(s.id);

  const counts = skuCounts(s);
  let exitedUnits = 0;
  let exitedValue = 0;
  for (const c of s.candidateItems) {
    if (c.disposition !== "intentional_exit") continue;
    exitedUnits += c.plannedUnits;
    exitedValue += c.plannedValue;
  }
  const toDecideUnits = counts.toDecideUnits;
  const toDecideValue = counts.toDecideValue;
  slice.items.planned = b.formalItemCount;
  slice.items.carryingForward = counts.carryingForward;
  slice.items.toDecide = counts.toDecide;
  slice.items.exited = counts.exited;

  // Units follow value's split: the unexplained share of unresolved money is
  // taken as the same share of unresolved units.
  const unexplainedShare = b.unresolvedValue > 0 ? b.unexplainedValue / b.unresolvedValue : 0;

  slice.units = {
    planned: b.formalUnits * weight,
    carryingForward: b.validatedUnits * weight,
    toDecide: toDecideUnits * weight,
    unexplained: b.unresolvedUnits * unexplainedShare * weight,
    exited: exitedUnits * weight,
  };
  if (valuesComparable) {
    slice.value = {
      planned: b.formalValue * weight,
      carryingForward: b.validatedValue * weight,
      toDecide: toDecideValue * weight,
      unexplained: b.unexplainedValue * weight,
      exited: exitedValue * weight,
    };
    slice.missingValue = b.unresolvedValue * weight;
  }
  slice.missingUnits = b.unresolvedUnits * weight;
  return slice;
}

export function buildPlanningHorizon(situations: readonly PlanningSituation[]): PlanningHorizon {
  const currencies = [...new Set(situations.map((s) => s.bridge.currency))].sort();
  const valuesComparable = currencies.length <= 1;

  const byMonth = new Map<MonthKey, HorizonSlice>();
  const total = emptySlice();
  const unphased: PlanningHorizon["unphased"] = [];

  for (const s of situations) {
    addSlice(total, situationSlice(s, 1, valuesComparable));
    const weights = s.productionWindow ? monthWeights(s.productionWindow) : new Map<MonthKey, number>();
    if (weights.size === 0) {
      unphased.push({ situationId: s.id, title: s.title });
      continue;
    }
    for (const [month, weight] of weights) {
      if (weight <= 0) continue;
      let slice = byMonth.get(month);
      if (!slice) {
        slice = emptySlice();
        byMonth.set(month, slice);
      }
      addSlice(slice, situationSlice(s, weight, valuesComparable));
    }
  }

  const months = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, slice]) => ({ period, ...slice }));

  return { months, total, currency: currencies[0] ?? "USD", valuesComparable, unphased };
}
