/**
 * The portfolio roll-up behind Overview (V2 §39).
 *
 * Overview used to lead with one situation's four metrics and then repeat the
 * same four on every row beneath. That answered "tell me about this one thing"
 * on a page whose only job is "tell me about everything".
 *
 * The question it answers now is the one a planner actually opens with: how
 * many products are not represented, and what does that do to the plan — to
 * the money, to the factory, and to what I can still order in time — across
 * the whole horizon.
 *
 * Pure: no React. Every figure is summed from the same situations the rest of
 * the app renders, so nothing here can disagree with a detail page.
 */

import type { MonthKey } from "@/types/dataset";
import type { MaterialPlanningStatus, PlanningSituation } from "@/types/situation";
import { skuCounts } from "./horizon";

/** One line carrying unresolved load, and the items putting it there. */
export interface ExposedLine {
  lineId: string;
  lineName: string;
  /** The month it is tightest. */
  period: string;
  effectiveUtilization: number;
  formalUtilization: number;
  targetUtilizationPct: number;
  /** Hours on it that no formal item accounts for. */
  unresolvedHours: number;
  availableHours: number;
  /** The items driving those hours, largest first. */
  drivers: { itemName: string; hours: number }[];
  /** The programme putting the most unresolved hours on it — the one to open first. */
  situationTitle: string;
  situationId: string;
  /** How many months in the window this line goes past target. */
  monthsOverTarget: number;
}

/** "All lines" — the plant total, summed across every line. */
export const ALL_LINES = "all";

/**
 * One month of load on a line (or the plant), cumulative across every
 * programme: hours already in the formal plan, hours the carried-forward SKUs
 * add, against what the line has. Shaped to feed `LoadCapacityChart`.
 */
export interface LineLoadMonth {
  period: MonthKey;
  committedHours: number;
  addedHours: number;
  capacityHours: number;
  /** committed / capacity, 0-1+. */
  committedUtilization: number;
  /** (committed + added) / capacity, 0-1+. */
  effectiveUtilization: number;
  /** committed + added beyond capacity; zero when it fits. */
  overCapacityHours: number;
  /** Every programme adding hours this month, most first. */
  byProgramme: { situationId: string; title: string; hours: number }[];
}

export interface LineLoadSeries {
  /** A line id, or `ALL_LINES`. */
  lineId: string;
  lineName: string;
  months: LineLoadMonth[];
  /** The month with the highest effective utilisation. */
  peakPeriod?: MonthKey;
  peakUtilization: number;
  monthsOverCapacity: number;
  overCapacityHours: number;
  /**
   * The whole horizon on this line, summed across every month shown — what a
   * section's headline figures read, so they hold still while a planner hovers
   * individual months.
   */
  totals: {
    committedHours: number;
    addedHours: number;
    capacityHours: number;
    /** Σ committed / Σ capacity. */
    committedUtilization: number;
    /** Σ (committed + added) / Σ capacity. */
    effectiveUtilization: number;
    /** Every programme adding hours in any month, most first. */
    byProgramme: { situationId: string; title: string; hours: number }[];
  };
}

/** A component the carried-forward SKUs need, in the words a planner acts on. */
export type OrderAction = "order_now" | "review_first" | "cannot_order_yet";

export interface ComponentToOrder {
  materialId: string;
  materialName: string;
  /** Net of stock when inventory was provided, otherwise gross. */
  quantity: number;
  netOfStock: boolean;
  uom: string;
  decisionDate: string;
  weeksToDecision: number;
  action: OrderAction;
  reason: string;
  situationId: string;
  situationTitle: string;
}

/**
 * What the plan looks like before the carried-forward SKUs are counted, and
 * after — a rollup of numbers already derived elsewhere on this page, not a new
 * MRP/PO object (V2 non-goals: no fabricated ERP/MRP data).
 */
export interface PortfolioBeforeAfter {
  demandValueBefore: number;
  demandValueAfter: number;
  /** The carried-forward SKUs' planned value. */
  addedValue: number;
  carriedForwardSkuCount: number;
  hoursBefore: number;
  hoursAfter: number;
  addedHours: number;
  /** The tightest line-month the added hours touch. */
  peak?: {
    lineName: string;
    period: MonthKey;
    effectiveUtilization: number;
    targetUtilizationPct: number;
  };
  /** Components these SKUs need, most urgent first. */
  components: ComponentToOrder[];
  currency: string;
  /** False when programmes are planned in more than one currency — see `PortfolioSummary.currencies`. */
  valuesComparable: boolean;
}

/** The first date anywhere in the portfolio that stops being reversible. */
export interface NearestDeadline {
  date: string;
  weeksAway: number;
  label: string;
  detail?: string;
  situationTitle: string;
  situationId: string;
}

export interface PortfolioSummary {
  /** Programmes in the portfolio. */
  situationCount: number;
  needsAttentionCount: number;

  /* --- what is missing --- */
  /**
   * Prior products missing from the plan: carrying forward plus still to
   * decide (`skuCounts`). The same figure as the horizon headline.
   */
  unrepresentedSkuCount: number;
  /** Of those, the ones the planner has accepted as carrying forward. */
  carryingForwardSkuCount: number;
  /** Prior products the planner has not decided about yet. */
  undecidedSkuCount: number;
  totalCandidateCount: number;

  /* --- what it is worth (sales) --- */
  currency: string;
  /** Every currency the programmes are planned in. */
  currencies: string[];
  /**
   * False when there is more than one currency. Heizen does not convert
   * currency, so the money fields below are then left at zero rather than
   * summed into a number labelled with whichever currency came first.
   */
  valuesComparable: boolean;
  expectedValue: number;
  formalValue: number;
  unresolvedValue: number;
  /** formal / expected across the portfolio, 0-1. */
  representedPct: number;
  /** What `representedPct` was measured in — units when money cannot be summed. */
  representedBasis: "value" | "units" | "unavailable";
  formalUnits: number;
  /** Undefined when any programme's business plan carries no unit target. */
  expectedUnits?: number;
  validatedUnits: number;
  validatedValue: number;

  /* --- what it does to the factory (manufacturing) --- */
  unresolvedHours: number;
  formalHours: number;
  exposedLines: ExposedLine[];
  /** Lines carrying unresolved load but still inside target. */
  linesCarryingLoadCount: number;

  /* --- what it puts on the clock (materials) --- */
  planNowCount: number;
  waitCount: number;
  nearestDeadline?: NearestDeadline;

  beforeAfter: PortfolioBeforeAfter;

  /* --- data completeness, never hidden --- */
  capacityUnavailable: boolean;
  materialsUnavailable: boolean;
}

/**
 * One line-month across the whole portfolio.
 *
 * Every situation's capacity cell for a line-month carries the *same* formal
 * load — `buildSituations` computes formal load once across the whole plan and
 * hands it to each programme. So the formal figure is taken once here, and
 * only each programme's own unresolved hours are added together.
 */
interface CellAccum {
  lineId: string;
  lineName: string;
  period: MonthKey;
  availableHours: number;
  targetUtilizationPct: number;
  formalHours: number;
  unresolvedHours: number;
  drivers: { itemName: string; hours: number }[];
  hoursBySituation: Map<string, { title: string; hours: number }>;
}

function accumulateCells(situations: readonly PlanningSituation[]): CellAccum[] {
  const cellAccum = new Map<string, CellAccum>();
  for (const s of situations) {
    for (const cell of s.capacityExposure.cells) {
      const key = `${cell.lineId}::${cell.period}`;
      let acc = cellAccum.get(key);
      if (!acc) {
        acc = {
          lineId: cell.lineId,
          lineName: cell.lineName,
          period: cell.period,
          availableHours: cell.availableHours,
          targetUtilizationPct: cell.targetUtilizationPct,
          formalHours: cell.formalHours,
          unresolvedHours: 0,
          drivers: [],
          hoursBySituation: new Map(),
        };
        cellAccum.set(key, acc);
      }
      if (cell.unresolvedHours <= 0) continue;

      acc.unresolvedHours += cell.unresolvedHours;
      acc.drivers.push(...cell.contributors.map((c) => ({ itemName: c.itemName, hours: c.hours })));
      const mine = acc.hoursBySituation.get(s.id)?.hours ?? 0;
      acc.hoursBySituation.set(s.id, { title: s.title, hours: mine + cell.unresolvedHours });
    }
  }
  return [...cellAccum.values()];
}

export function summarizePortfolio(situations: readonly PlanningSituation[]): PortfolioSummary {
  const empty: PortfolioSummary = {
    situationCount: 0,
    needsAttentionCount: 0,
    unrepresentedSkuCount: 0,
    carryingForwardSkuCount: 0,
    undecidedSkuCount: 0,
    totalCandidateCount: 0,
    currency: "USD",
    currencies: [],
    valuesComparable: true,
    expectedValue: 0,
    formalValue: 0,
    unresolvedValue: 0,
    representedPct: 0,
    representedBasis: "value",
    formalUnits: 0,
    validatedUnits: 0,
    validatedValue: 0,
    unresolvedHours: 0,
    formalHours: 0,
    exposedLines: [],
    linesCarryingLoadCount: 0,
    planNowCount: 0,
    waitCount: 0,
    beforeAfter: {
      demandValueBefore: 0,
      demandValueAfter: 0,
      addedValue: 0,
      carriedForwardSkuCount: 0,
      hoursBefore: 0,
      hoursAfter: 0,
      addedHours: 0,
      components: [],
      currency: "USD",
      valuesComparable: true,
    },
    capacityUnavailable: false,
    materialsUnavailable: false,
  };

  if (situations.length === 0) return empty;

  const out: PortfolioSummary = { ...empty, situationCount: situations.length };

  // Money only adds up within one currency. A workbook that plans one
  // programme in USD and another in EUR gets no portfolio money total, rather
  // than one silently labelled with whichever currency came first.
  out.currencies = [...new Set(situations.map((s) => s.bridge.currency))].sort();
  out.valuesComparable = out.currencies.length <= 1;
  out.currency = out.currencies[0] ?? "USD";

  const deadlines: NearestDeadline[] = [];
  const components: ComponentToOrder[] = [];
  let expectedUnits = 0;
  let expectedUnitsKnown = true;

  for (const s of situations) {
    if (s.state === "ACTION_NEEDED" || s.state === "MONITOR") out.needsAttentionCount++;

    if (out.valuesComparable) {
      out.expectedValue += s.bridge.expectedValue;
      out.formalValue += s.bridge.formalValue;
      out.unresolvedValue += s.bridge.unresolvedValue;
      out.validatedValue += s.bridge.validatedValue;
    }
    out.validatedUnits += s.bridge.validatedUnits;
    out.formalUnits += s.bridge.formalUnits;
    if (s.bridge.expectedUnits === undefined) expectedUnitsKnown = false;
    else expectedUnits += s.bridge.expectedUnits;

    out.totalCandidateCount += s.candidateItems.length;
    const counts = skuCounts(s);
    out.unrepresentedSkuCount += counts.missing;
    out.carryingForwardSkuCount += counts.carryingForward;
    out.undecidedSkuCount += counts.toDecide;

    if (!s.capacityExposure.available) out.capacityUnavailable = true;

    if (!s.materialExposure.available) out.materialsUnavailable = true;
    out.planNowCount += s.materialExposure.planNowCount;
    out.waitCount += s.materialExposure.waitCount;
    for (const row of s.materialExposure.rows) {
      components.push({
        materialId: row.materialId,
        materialName: row.materialName,
        quantity: (row.netRequirement ?? row.requirementBase),
        netOfStock: row.netRequirement !== undefined,
        uom: row.uom,
        decisionDate: row.decisionDate,
        weeksToDecision: row.weeksToDecision,
        action: ORDER_ACTION[row.status],
        reason: row.reason,
        situationId: s.id,
        situationTitle: s.title,
      });
    }

    const earliest = s.runway.earliest;
    if (earliest) {
      deadlines.push({
        date: earliest.date,
        weeksAway: earliest.weeksAway,
        label: earliest.label,
        detail: earliest.detail,
        situationTitle: s.title,
        situationId: s.id,
      });
    }
  }

  if (out.valuesComparable) {
    out.representedBasis = "value";
    out.representedPct = out.expectedValue > 0 ? Math.min(1, out.formalValue / out.expectedValue) : 0;
  } else if (expectedUnitsKnown && expectedUnits > 0) {
    // Units carry no currency, so they can still say how much is represented.
    out.representedBasis = "units";
    out.representedPct = Math.min(1, out.formalUnits / expectedUnits);
  } else {
    out.representedBasis = "unavailable";
    out.representedPct = 0;
  }
  out.expectedUnits = expectedUnitsKnown ? expectedUnits : undefined;

  // Formal load on a line-month is one plant-wide figure, counted once.
  const cells = accumulateCells(situations);
  for (const cell of cells) {
    out.formalHours += cell.formalHours;
    out.unresolvedHours += cell.unresolvedHours;
  }

  // Utilisation is recomputed from the combined load rather than taken from
  // any one programme's cell: two programmes each adding a few points to the
  // same line-month can push it past target together when neither does alone.
  const carrying = cells.filter((c) => c.unresolvedHours > 0).map(toExposedLine);
  out.linesCarryingLoadCount = new Set(carrying.map((l) => l.lineId)).size;

  // Only lines the unresolved load actually pushes past target. A line running
  // hot on formal work alone is not something this product found.
  //
  // One row per line, at its worst month. The same line appearing three times
  // for three consecutive months is one problem listed three times.
  const worstByLine = new Map<string, ExposedLine>();
  const monthsOverByLine = new Map<string, number>();
  for (const line of carrying) {
    if (line.effectiveUtilization <= line.targetUtilizationPct) continue;
    monthsOverByLine.set(line.lineId, (monthsOverByLine.get(line.lineId) ?? 0) + 1);
    const worst = worstByLine.get(line.lineId);
    if (!worst || line.effectiveUtilization > worst.effectiveUtilization) {
      worstByLine.set(line.lineId, line);
    }
  }

  out.exposedLines = [...worstByLine.values()]
    .map((l) => ({
      ...l,
      drivers: topDrivers(l.drivers),
      monthsOverTarget: monthsOverByLine.get(l.lineId) ?? 1,
    }))
    .sort((a, b) => b.effectiveUtilization - a.effectiveUtilization);

  out.nearestDeadline = deadlines.sort((a, b) => a.date.localeCompare(b.date))[0];

  const peak = [...carrying].sort((a, b) => b.effectiveUtilization - a.effectiveUtilization)[0];
  out.beforeAfter = {
    demandValueBefore: out.formalValue,
    demandValueAfter: out.formalValue + out.validatedValue,
    addedValue: out.validatedValue,
    carriedForwardSkuCount: out.carryingForwardSkuCount,
    hoursBefore: out.formalHours,
    hoursAfter: out.formalHours + out.unresolvedHours,
    addedHours: out.unresolvedHours,
    peak: peak
      ? {
          lineName: peak.lineName,
          period: peak.period,
          effectiveUtilization: peak.effectiveUtilization,
          targetUtilizationPct: peak.targetUtilizationPct,
        }
      : undefined,
    components: components.sort(byUrgency),
    currency: out.currency,
    valuesComparable: out.valuesComparable,
  };

  return out;
}

/**
 * The words on the component list. `WAIT` is "can't order yet", never softened:
 * packaging whose artwork or specification is unsettled cannot be ordered
 * however predictable the ingredients beside it are (V2 §15.6).
 */
const ORDER_ACTION: Record<MaterialPlanningStatus, OrderAction> = {
  PLAN_NOW: "order_now",
  REVIEW: "review_first",
  WAIT: "cannot_order_yet",
};

const ACTION_RANK: Record<OrderAction, number> = { order_now: 0, review_first: 1, cannot_order_yet: 2 };

function byUrgency(a: ComponentToOrder, b: ComponentToOrder): number {
  return (
    a.weeksToDecision - b.weeksToDecision ||
    ACTION_RANK[a.action] - ACTION_RANK[b.action] ||
    a.materialName.localeCompare(b.materialName)
  );
}

/** Every line the programmes produce on, by name. */
export function listLoadLines(situations: readonly PlanningSituation[]): { lineId: string; lineName: string }[] {
  const lines = new Map<string, string>();
  for (const acc of accumulateCells(situations)) lines.set(acc.lineId, acc.lineName);
  return [...lines.entries()]
    .map(([lineId, lineName]) => ({ lineId, lineName }))
    .sort((a, b) => a.lineName.localeCompare(b.lineName));
}

/**
 * Load against capacity for one line — or, with `ALL_LINES`, the plant total —
 * month by month, cumulative across every programme. Formal load on a
 * line-month is counted once; each programme's carried-forward hours are added
 * on top (`accumulateCells`). Always the whole horizon.
 */
export function buildLineLoadSeries(situations: readonly PlanningSituation[], lineId: string): LineLoadSeries {
  const cells = accumulateCells(situations).filter((c) => lineId === ALL_LINES || c.lineId === lineId);

  const byPeriod = new Map<MonthKey, { committed: number; added: number; capacity: number; programmes: Map<string, { title: string; hours: number }> }>();
  for (const c of cells) {
    let m = byPeriod.get(c.period);
    if (!m) {
      m = { committed: 0, added: 0, capacity: 0, programmes: new Map() };
      byPeriod.set(c.period, m);
    }
    m.committed += c.formalHours;
    m.added += c.unresolvedHours;
    m.capacity += c.availableHours;
    for (const [id, entry] of c.hoursBySituation) {
      const mine = m.programmes.get(id);
      m.programmes.set(id, { title: entry.title, hours: (mine?.hours ?? 0) + entry.hours });
    }
  }

  const months: LineLoadMonth[] = [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, m]) => ({
      period,
      committedHours: m.committed,
      addedHours: m.added,
      capacityHours: m.capacity,
      committedUtilization: m.capacity > 0 ? m.committed / m.capacity : 0,
      effectiveUtilization: m.capacity > 0 ? (m.committed + m.added) / m.capacity : 0,
      overCapacityHours: Math.max(0, m.committed + m.added - m.capacity),
      byProgramme: [...m.programmes.entries()]
        .map(([situationId, entry]) => ({ situationId, title: entry.title, hours: entry.hours }))
        .sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title)),
    }));

  const peak = months.reduce<LineLoadMonth | undefined>(
    (best, m) => (!best || m.effectiveUtilization > best.effectiveUtilization ? m : best),
    undefined
  );
  const lineName =
    lineId === ALL_LINES ? "All lines (plant total)" : (cells[0]?.lineName ?? lineId);

  const committedHours = months.reduce((n, m) => n + m.committedHours, 0);
  const addedHours = months.reduce((n, m) => n + m.addedHours, 0);
  const capacityHours = months.reduce((n, m) => n + m.capacityHours, 0);
  const programmes = new Map<string, { title: string; hours: number }>();
  for (const m of months) {
    for (const p of m.byProgramme) {
      const mine = programmes.get(p.situationId);
      programmes.set(p.situationId, { title: p.title, hours: (mine?.hours ?? 0) + p.hours });
    }
  }

  return {
    lineId,
    lineName,
    months,
    peakPeriod: peak?.period,
    peakUtilization: peak?.effectiveUtilization ?? 0,
    monthsOverCapacity: months.filter((m) => m.overCapacityHours > 0).length,
    overCapacityHours: months.reduce((n, m) => n + m.overCapacityHours, 0),
    totals: {
      committedHours,
      addedHours,
      capacityHours,
      committedUtilization: capacityHours > 0 ? committedHours / capacityHours : 0,
      effectiveUtilization: capacityHours > 0 ? (committedHours + addedHours) / capacityHours : 0,
      byProgramme: [...programmes.entries()]
        .map(([situationId, entry]) => ({ situationId, title: entry.title, hours: entry.hours }))
        .sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title)),
    },
  };
}

/**
 * The line that goes furthest past capacity at its peak — the one a planner
 * should see first. Falls back to the most-utilised line when none is over.
 */
export function worstLoadLine(situations: readonly PlanningSituation[]): string | undefined {
  let worst: LineLoadSeries | undefined;
  for (const { lineId } of listLoadLines(situations)) {
    const series = buildLineLoadSeries(situations, lineId);
    if (!worst || series.peakUtilization > worst.peakUtilization) worst = series;
  }
  return worst?.lineId;
}

function toExposedLine(cell: CellAccum): ExposedLine {
  const effectiveHours = cell.formalHours + cell.unresolvedHours;
  const lead = [...cell.hoursBySituation.entries()].sort(
    (a, b) => b[1].hours - a[1].hours || a[0].localeCompare(b[0])
  )[0];
  return {
    lineId: cell.lineId,
    lineName: cell.lineName,
    period: cell.period,
    effectiveUtilization: cell.availableHours > 0 ? effectiveHours / cell.availableHours : 0,
    formalUtilization: cell.availableHours > 0 ? cell.formalHours / cell.availableHours : 0,
    targetUtilizationPct: cell.targetUtilizationPct,
    unresolvedHours: cell.unresolvedHours,
    availableHours: cell.availableHours,
    drivers: cell.drivers,
    situationTitle: lead?.[1].title ?? "",
    situationId: lead?.[0] ?? "",
    monthsOverTarget: 1,
  };
}

/** The few items that account for most of a line's unresolved hours. */
function topDrivers(
  drivers: { itemName: string; hours: number }[]
): { itemName: string; hours: number }[] {
  const byName = new Map<string, number>();
  for (const d of drivers) byName.set(d.itemName, (byName.get(d.itemName) ?? 0) + d.hours);
  return [...byName.entries()]
    .map(([itemName, hours]) => ({ itemName, hours }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 3);
}
