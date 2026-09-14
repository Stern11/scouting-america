/**
 * Scenario overrides for V2.
 *
 * A scenario is applied by producing a *new* `PlanningDataset` with the
 * overridden values substituted in, then running the ordinary
 * `buildSituations` over it. Nothing about the baseline is mutated, and the
 * derived result is never stored — which is what keeps "what the workbook
 * said" and "what I am testing" separable at every point (V2 §53).
 */

import type { PlanningDataset } from "@/types/dataset";
import type {
  AdjustmentDiff,
  ScenarioAdjustmentCategory,
  ScenarioAdjustments,
} from "@/types/situation";
import { EMPTY_ADJUSTMENTS } from "@/types/situation";
import { formatMonthLabel } from "@/lib/dataset/periods";

export function capacityKey(lineId: string, period: string): string {
  return `${lineId}::${period}`;
}

export function mappingKey(itemOrFamilyId: string, lineId: string): string {
  return `${itemOrFamilyId}::${lineId}`;
}

/** Keys one analogue's weight within one candidate's blend. */
export function analogueKey(candidateId: string, analogueId: string): string {
  return `${candidateId}::${analogueId}`;
}

/** Guards against a typo turning into a nonsensical plan. */
const LIMITS = {
  availableHours: { min: 0, max: 2000 },
  targetUtilization: { min: 0.3, max: 1.2 },
  runRate: { min: 1, max: 500_000 },
  allocation: { min: 0, max: 1 },
  leadTimeDays: { min: 0, max: 730 },
  volumeUnits: { min: 0, max: 1_000_000_000 },
  analogueWeights: { min: 0, max: 1 },
};

export function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * Returns a dataset with the scenario's values substituted in. Rows the
 * scenario does not touch are passed through by reference — only overridden
 * rows are copied, so applying a scenario stays cheap enough to run on every
 * keystroke.
 */
export function applyScenarioToDataset(
  dataset: PlanningDataset,
  adjustments: ScenarioAdjustments = EMPTY_ADJUSTMENTS
): PlanningDataset {
  const hasCapacity =
    Object.keys(adjustments.availableHours).length > 0 ||
    Object.keys(adjustments.targetUtilization).length > 0;
  const hasMapping =
    Object.keys(adjustments.runRate).length > 0 || Object.keys(adjustments.allocation).length > 0;

  if (!hasCapacity && !hasMapping) return dataset;

  const lineCapacity = hasCapacity
    ? dataset.lineCapacity.map((row) => {
        const hours = adjustments.availableHours[capacityKey(row.lineId, row.period)];
        const target = adjustments.targetUtilization[row.lineId];
        if (hours === undefined && target === undefined) return row;
        return {
          ...row,
          availableHours: hours === undefined ? row.availableHours : clamp(hours, LIMITS.availableHours),
          targetUtilizationPct:
            target === undefined ? row.targetUtilizationPct : clamp(target, LIMITS.targetUtilization),
        };
      })
    : dataset.lineCapacity;

  const shares = hasMapping ? effectiveAllocations(dataset, adjustments.allocation) : new Map<string, number>();
  const itemLineMappings = hasMapping
    ? dataset.itemLineMappings.map((row) => {
        const key = mappingKey(row.itemOrFamilyId, row.lineId);
        const rate = adjustments.runRate[key];
        const share = shares.get(allocationRowKey(row));
        if (rate === undefined && share === undefined) return row;
        return {
          ...row,
          runRateUnitsPerHour: rate === undefined ? row.runRateUnitsPerHour : clamp(rate, LIMITS.runRate),
          allocationPct: share === undefined ? row.allocationPct : share,
        };
      })
    : dataset.itemLineMappings;

  return { ...dataset, lineCapacity, itemLineMappings };
}

/* ------------------------------------------------------------------ */
/* Line split                                                          */
/* ------------------------------------------------------------------ */

/** One mapping row, unique across mapping levels. */
function allocationRowKey(row: { mappingLevel: string; itemOrFamilyId: string; lineId: string }): string {
  return `${row.mappingLevel}::${row.itemOrFamilyId.toLowerCase()}::${row.lineId}`;
}

/**
 * Rebalances a split so it sums to exactly 100%.
 *
 * A family cannot be sent 100% to one line and 100% to another — that was a
 * real bug. The lines a planner has set are held and the untouched lines
 * absorb the remainder in proportion to their baseline shares. If the held
 * lines alone exceed 100% (or nothing is left to absorb), the held lines are
 * scaled down together.
 */
export function normalizeShares(parts: readonly { baseline: number; override?: number }[]): number[] {
  if (parts.length === 0) return [];
  const held = parts.map((p) => (p.override === undefined ? undefined : clamp(p.override, LIMITS.allocation)));
  const heldSum = held.reduce<number>((s, v) => s + (v ?? 0), 0);
  const freeIdx = parts.map((_, i) => i).filter((i) => held[i] === undefined);

  if (freeIdx.length === 0 || heldSum >= 1) {
    if (heldSum <= 0) return parts.map(() => 1 / parts.length);
    return held.map((v) => (v === undefined ? 0 : v / heldSum));
  }

  const remainder = 1 - heldSum;
  const freeBaseline = freeIdx.reduce((s, i) => s + Math.max(0, parts[i]!.baseline), 0);
  return parts.map((p, i) => {
    const h = held[i];
    if (h !== undefined) return h;
    return freeBaseline > 0 ? (Math.max(0, p.baseline) / freeBaseline) * remainder : remainder / freeIdx.length;
  });
}

/**
 * Effective share for every mapping row in an item/family whose split the
 * scenario touches, normalised so each item/family sums to 100%. Rows in an
 * untouched item/family are absent — they pass through as the data says.
 */
export function effectiveAllocations(
  dataset: PlanningDataset,
  overrides: Record<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  if (Object.keys(overrides).length === 0) return out;

  const groups = new Map<string, PlanningDataset["itemLineMappings"]>();
  for (const row of dataset.itemLineMappings) {
    const group = `${row.mappingLevel}::${row.itemOrFamilyId.toLowerCase()}`;
    const list = groups.get(group);
    if (list) list.push(row);
    else groups.set(group, [row]);
  }

  for (const rows of groups.values()) {
    const parts = rows.map((row) => ({
      baseline: row.allocationPct ?? 1 / rows.length,
      override: overrides[mappingKey(row.itemOrFamilyId, row.lineId)],
    }));
    if (parts.every((p) => p.override === undefined)) continue;
    const shares = normalizeShares(parts);
    rows.forEach((row, i) => out.set(allocationRowKey(row), shares[i]!));
  }
  return out;
}

/**
 * The baseline-vs-scenario delta list for everything whose baseline is readable
 * straight from the dataset. Only genuinely changed values appear — a control
 * the planner touched and put back is not a change.
 *
 * Lead times are the one exception; see the note at the end of the function.
 */
/**
 * One category's rule for turning an override into a diff row: how to find the
 * baseline it should be compared against, and how to describe it.
 *
 * Table-driven rather than one hand-written loop per category — with six
 * categories the loops had begun to differ from each other in ways that were
 * accidental rather than meaningful.
 */
interface DiffSpec {
  category: ScenarioAdjustmentCategory;
  unit: string;
  /** Below this the change is a round-trip, not a change. */
  epsilon: number;
  resolve: (
    dataset: PlanningDataset,
    key: string
  ) => { baseline: number; label: string } | undefined;
}

const DIFF_SPECS: DiffSpec[] = [
  {
    category: "availableHours",
    unit: "h",
    epsilon: 0.5,
    resolve: (dataset, key) => {
      const row = dataset.lineCapacity.find((r) => capacityKey(r.lineId, r.period) === key);
      if (!row) return undefined;
      return {
        baseline: row.availableHours,
        label: `${row.lineName} · ${formatMonthLabel(row.period)} available hours`,
      };
    },
  },
  {
    category: "targetUtilization",
    unit: "%",
    epsilon: 0.001,
    resolve: (dataset, key) => {
      const row = dataset.lineCapacity.find((r) => r.lineId === key);
      if (!row) return undefined;
      return { baseline: row.targetUtilizationPct ?? 0.9, label: `${row.lineName} target utilisation` };
    },
  },
  {
    category: "runRate",
    unit: "/h",
    epsilon: 0.5,
    resolve: (dataset, key) => {
      const row = dataset.itemLineMappings.find(
        (r) => mappingKey(r.itemOrFamilyId, r.lineId) === key
      );
      if (!row) return undefined;
      return {
        baseline: row.runRateUnitsPerHour,
        label: `${row.itemOrFamilyId} on ${row.lineId} run rate`,
      };
    },
  },
  {
    category: "allocation",
    unit: "%",
    epsilon: 0.001,
    resolve: (dataset, key) => {
      const row = dataset.itemLineMappings.find(
        (r) => mappingKey(r.itemOrFamilyId, r.lineId) === key
      );
      if (!row) return undefined;
      return { baseline: row.allocationPct ?? 1, label: `${row.itemOrFamilyId} share on ${row.lineId}` };
    },
  },
];

/**
 * The baseline-vs-scenario delta list for everything whose baseline is readable
 * straight from the dataset. Only genuinely changed values appear — a control
 * the planner touched and put back is not a change.
 *
 * Two categories are deliberately absent, both for the same reason: their
 * baseline is *resolved* inside `buildSituations` rather than being a dataset
 * column, so a diff computed here would compare against a number the planner
 * never saw.
 *
 * - Lead time is resolved from system assumption vs observed median vs P80.
 * - Carry-forward volume is resolved from the season basis and its growth.
 *
 * The caller emits both from the built situation, where the resolved baselines
 * actually live.
 */
export function diffAdjustments(
  dataset: PlanningDataset,
  adjustments: ScenarioAdjustments
): AdjustmentDiff[] {
  const diffs: AdjustmentDiff[] = [];
  // A share is compared as it is actually applied: rebalanced to sum to 100%.
  const shares = effectiveAllocations(dataset, adjustments.allocation ?? {});

  for (const spec of DIFF_SPECS) {
    const overrides = adjustments[spec.category] ?? {};
    for (const [key, scenario] of Object.entries(overrides)) {
      const resolved = spec.resolve(dataset, key);
      if (!resolved) continue;
      const mappingRow =
        spec.category === "allocation"
          ? dataset.itemLineMappings.find((r) => mappingKey(r.itemOrFamilyId, r.lineId) === key)
          : undefined;
      const value =
        (mappingRow ? shares.get(allocationRowKey(mappingRow)) : undefined) ?? clamp(scenario, LIMITS[spec.category]);
      if (Math.abs(value - resolved.baseline) < spec.epsilon) continue;
      diffs.push({
        category: spec.category,
        key,
        label: resolved.label,
        baseline: resolved.baseline,
        scenario: value,
        delta: value - resolved.baseline,
        unit: spec.unit,
      });
    }
  }

  return diffs;
}

export function countAdjustments(adjustments: ScenarioAdjustments): number {
  return (
    Object.keys(adjustments.availableHours).length +
    Object.keys(adjustments.targetUtilization).length +
    Object.keys(adjustments.runRate).length +
    Object.keys(adjustments.allocation).length +
    Object.keys(adjustments.leadTimeDays).length +
    Object.keys(adjustments.volumeUnits ?? {}).length +
    Object.keys(adjustments.analogueWeights ?? {}).length
  );
}

/**
 * True when two adjustment sets hold the same overrides — the test for a
 * scenario draft differing from what was last saved. Works for any shape of
 * `{ category: { key: number } }`, so demand and capacity scenarios share it.
 * A missing category and an empty one are the same thing.
 */
export function sameAdjustments(a: object, b: object): boolean {
  const left = a as Record<string, Record<string, number> | undefined>;
  const right = b as Record<string, Record<string, number> | undefined>;
  const categories = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const category of categories) {
    const l = left[category] ?? {};
    const r = right[category] ?? {};
    const keys = Object.keys(l);
    if (keys.length !== Object.keys(r).length) return false;
    for (const key of keys) {
      if (!(key in r) || Math.abs((l[key] ?? 0) - (r[key] ?? 0)) > 1e-9) return false;
    }
  }
  return true;
}
