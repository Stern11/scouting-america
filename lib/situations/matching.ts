/**
 * Attribute matching between prior-season items and the current formal plan.
 *
 * This is deliberately not a prediction model. It compares business attributes
 * the planner already understands, and every result carries the list of
 * attributes that agreed and disagreed, so the screen can answer "why is this
 * matched?" rather than showing a bare 87% (V2 §43).
 *
 * Pure — no dataset imports, no dates, no randomness.
 */

import type {
  CandidateItem,
  ContributorDisposition,
  DimensionOutcome,
  MatchConfig,
  MatchDimension,
  MatchResult,
} from "@/types/situation";
import type { CurrentPlanRow, HistoricalItemRow } from "@/types/dataset";
import { eventLabel } from "@/lib/dataset/periods";

/**
 * The dimensions a prior item can be compared to a *current plan* item on.
 *
 * The pack, formulation and packaging attributes deliberately do not appear:
 * `Current_Plan` does not carry them, so comparing on them would always be
 * "not comparable" and would quietly dilute every score. They earn their keep
 * in analogue ranking instead, where both sides are historical items.
 */
export const REPRESENTATION_DIMENSIONS: readonly MatchDimension[] = [
  "brand",
  "product_family",
  "event",
  "customer",
  "channel",
];

/**
 * Weights reflect how strongly each attribute implies "this is the same piece
 * of business": brand and family are structural, customer and channel are
 * strong qualifiers, event is context.
 */
export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  dimensions: [
    { dimension: "brand", weight: 3, enabled: true },
    { dimension: "product_family", weight: 3, enabled: true },
    { dimension: "event", weight: 1, enabled: true },
    { dimension: "customer", weight: 2, enabled: true },
    { dimension: "channel", weight: 1, enabled: true },
  ],
  threshold: 0.8,
};

/** Statuses that mean the business deliberately stopped, not that it is missing. */
const EXIT_STATUSES = new Set([
  "discontinued",
  "delisted",
  "exited",
  "obsolete",
  "cancelled",
  "canceled",
  "dropped",
]);

function normalize(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Normalises one attribute for comparison.
 *
 * Event is the special case: a prior item is tagged "Halloween 2026" and its
 * successor "Halloween 2027", so comparing the raw strings marked the event as
 * *different* on literally every row — the one thing that is always true of a
 * prior season. Stripping the year compares the programme, which is what the
 * dimension is actually for.
 */
function comparable(value: string | undefined, dimension: MatchDimension): string | undefined {
  if (value === undefined) return undefined;
  if (dimension === "event") {
    const label = eventLabel(value);
    return label === "" ? undefined : label;
  }
  return normalize(value);
}

function historicalAttribute(row: HistoricalItemRow, dimension: MatchDimension): string | undefined {
  switch (dimension) {
    case "brand":
      return row.brand;
    case "product_family":
      return row.productFamily;
    case "event":
      return row.eventOrProgram;
    case "customer":
      return row.customer;
    case "channel":
      return row.channel;
    case "pack_format":
      return row.packFormat;
    case "pack_size":
      return row.packSize === undefined ? undefined : String(row.packSize);
    case "flavor_or_variant":
      return row.flavorOrVariant;
    case "formula_family":
      return row.formulaFamily;
    case "packaging_type":
      return row.packagingType;
    case "base_pack":
      return row.basePack;
  }
}

function currentAttribute(row: CurrentPlanRow, dimension: MatchDimension): string | undefined {
  switch (dimension) {
    case "brand":
      return row.brand;
    case "product_family":
      return row.productFamily;
    case "event":
      return row.eventOrProgram;
    case "customer":
      return row.customer;
    case "channel":
      return row.channel;
    default:
      // Not carried on Current_Plan — never comparable in this direction.
      return undefined;
  }
}

/**
 * Compares one prior item to one current-plan item.
 *
 * The score is the weighted share of *comparable* dimensions that agreed. A
 * dimension where either side is blank is excluded from both numerator and
 * denominator rather than counted as a mismatch, so a sparsely-filled optional
 * column cannot drag an otherwise clear match below the threshold.
 */
export function compareToCurrentItem(
  historical: HistoricalItemRow,
  current: CurrentPlanRow,
  config: MatchConfig = DEFAULT_MATCH_CONFIG
): MatchResult {
  const outcomes: DimensionOutcome[] = [];
  let weightMatched = 0;
  let weightCompared = 0;

  for (const dim of config.dimensions) {
    if (!dim.enabled) continue;
    if (!REPRESENTATION_DIMENSIONS.includes(dim.dimension)) continue;

    const h = comparable(historicalAttribute(historical, dim.dimension), dim.dimension);
    const c = comparable(currentAttribute(current, dim.dimension), dim.dimension);

    if (h === undefined || c === undefined) {
      outcomes.push({
        dimension: dim.dimension,
        status: "not_comparable",
        historicalValue: historicalAttribute(historical, dim.dimension),
        currentValue: currentAttribute(current, dim.dimension),
      });
      continue;
    }

    weightCompared += dim.weight;
    const same = h === c;
    if (same) weightMatched += dim.weight;
    outcomes.push({
      dimension: dim.dimension,
      status: same ? "same" : "different",
      historicalValue: historicalAttribute(historical, dim.dimension),
      currentValue: currentAttribute(current, dim.dimension),
    });
  }

  // The same item id carried into the new plan is direct evidence, not
  // inference — it outranks any attribute comparison.
  const sameItemId = historical.itemId === current.itemId;
  const score = sameItemId ? 1 : weightCompared === 0 ? 0 : weightMatched / weightCompared;

  return {
    matchedItemId: current.itemId,
    matchedItemName: current.itemName,
    matchedUnits: current.plannedUnits,
    score,
    comparedDimensions: outcomes.filter((o) => o.status !== "not_comparable").length,
    outcomes,
  };
}

/**
 * Finds the current-plan item that best explains a prior item.
 *
 * Ties break toward the higher comparable-dimension count: a match backed by
 * four attributes is more trustworthy than the same score from one.
 */
export function matchToCurrentPlan(
  historical: HistoricalItemRow,
  currentItems: readonly CurrentPlanRow[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG
): MatchResult {
  let best: MatchResult | undefined;

  for (const current of currentItems) {
    const result = compareToCurrentItem(historical, current, config);
    if (
      best === undefined ||
      result.score > best.score ||
      (result.score === best.score && result.comparedDimensions > best.comparedDimensions)
    ) {
      best = result;
    }
  }

  if (best === undefined) {
    return { score: 0, comparedDimensions: 0, outcomes: [] };
  }

  // Below the threshold there is no claim of representation, so we keep the
  // explanation but drop the item pointer.
  if (best.score < config.threshold) {
    return { ...best, matchedItemId: undefined, matchedItemName: undefined, matchedUnits: undefined };
  }
  return best;
}

/**
 * The disposition the product proposes before the planner has looked.
 *
 * The signal is whether the item was *assigned* a successor in the plan, not
 * how high it scored: after a one-to-one assignment an unassigned item is
 * unrepresented however many attributes it happens to share with something
 * else. Unassigned business defaults to `carry_forward` — it ran last season
 * and nothing in the plan replaces it — which is both the planning-safe
 * reading and the one a planner is most likely to confirm.
 *
 * The exception is an item that scored high enough to have been a match and
 * only lost the assignment to a closer pair. That is genuinely ambiguous, so
 * it is put in front of the planner as `under_review` rather than being
 * counted as load.
 */
export function proposeDisposition(
  historical: HistoricalItemRow,
  match: MatchResult,
  config: MatchConfig = DEFAULT_MATCH_CONFIG
): ContributorDisposition {
  const status = normalize(historical.status);
  if (status && EXIT_STATUSES.has(status)) return "intentional_exit";
  if (match.matchedItemId) return "already_represented";
  if (match.score >= config.threshold) return "under_review";
  return "carry_forward";
}

/**
 * A short planner-readable explanation of a match, e.g.
 * "Brand, product family, customer match; channel differs".
 */
export function explainMatch(match: MatchResult): string {
  const label = (d: MatchDimension) => DIMENSION_LABELS[d];
  const same = match.outcomes.filter((o) => o.status === "same").map((o) => label(o.dimension));
  const different = match.outcomes
    .filter((o) => o.status === "different")
    .map((o) => label(o.dimension));

  if (same.length === 0 && different.length === 0) return "No comparable attributes";

  const parts: string[] = [];
  if (same.length > 0) parts.push(`${same.join(", ")} match`);
  if (different.length > 0) parts.push(`${different.join(", ")} ${different.length === 1 ? "differs" : "differ"}`);
  return parts.join("; ");
}

export const DIMENSION_LABELS: Record<MatchDimension, string> = {
  brand: "Brand",
  product_family: "Product family",
  event: "Event",
  customer: "Customer",
  channel: "Channel",
  pack_format: "Pack format",
  pack_size: "Pack size",
  flavor_or_variant: "Flavour",
  formula_family: "Formulation",
  packaging_type: "Packaging",
  base_pack: "Base pack",
};

export const DISPOSITION_LABELS: Record<ContributorDisposition, string> = {
  unreviewed: "Unreviewed",
  carry_forward: "Carry forward",
  already_represented: "Already represented",
  intentional_exit: "Intentional exit",
  under_review: "Under review",
  new_or_changed: "New or changed",
};

/**
 * Assigns prior items to the current-plan items that represent them, one to
 * one.
 *
 * Scoring each prior item against the whole plan independently is not enough:
 * with a handful of brands and families, almost every prior item shares
 * attributes with *some* current item, so everything scores as represented and
 * nothing is left to explain the gap. A plan item can only stand for one prior
 * item, so the assignment is what the planner actually means by "this one came
 * back and that one did not".
 *
 * The assignment is solved, not picked greedily. Taking the single best pair
 * first can strand a second prior item whose only acceptable match was the
 * one just taken — and a stranded item becomes carry-forward load, i.e. a
 * planning gap the matcher invented. In order of priority:
 *
 * 1. A carried-over item id is direct evidence and is assigned before anything
 *    is inferred.
 * 2. Represent as many prior items as the threshold allows.
 * 3. Among those, the highest total match score.
 * 4. Then more compared attributes, then earlier ids, so ties are stable.
 */
export function assignRepresentation(
  historicalItems: readonly HistoricalItemRow[],
  currentItems: readonly CurrentPlanRow[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG
): Map<string, MatchResult> {
  const edges: Edge[] = [];
  const best = new Map<string, MatchResult>();

  historicalItems.forEach((historical, h) => {
    let bestForRow: MatchResult | undefined;
    currentItems.forEach((current, c) => {
      const result = compareToCurrentItem(historical, current, config);
      if (
        bestForRow === undefined ||
        result.score > bestForRow.score ||
        (result.score === bestForRow.score && result.comparedDimensions > bestForRow.comparedDimensions)
      ) {
        bestForRow = result;
      }
      if (result.score >= config.threshold) edges.push({ h, c, result });
    });
    // Kept so an unassigned row can still explain which attributes lined up.
    best.set(
      historical.id,
      bestForRow
        ? { ...bestForRow, matchedItemId: undefined, matchedItemName: undefined, matchedUnits: undefined }
        : { score: 0, comparedDimensions: 0, outcomes: [] }
    );
  });

  // Rank by id so ties resolve the same way whatever order the rows arrive in.
  const rowRank = new Map(
    historicalItems
      .map((row, h) => ({ id: row.id, h }))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ h }, rank) => [h, rank] as const)
  );

  const assigned = new Map<string, MatchResult>();
  const takenRow = new Set<number>();
  const takenCol = new Set<number>();
  const take = (edge: Edge) => {
    takenRow.add(edge.h);
    takenCol.add(edge.c);
    assigned.set(historicalItems[edge.h]!.id, edge.result);
  };

  const exact = edges
    .filter((e) => historicalItems[e.h]!.itemId === currentItems[e.c]!.itemId)
    .sort((a, b) => rowRank.get(a.h)! - rowRank.get(b.h)! || a.c - b.c);
  for (const edge of exact) {
    if (!takenRow.has(edge.h) && !takenCol.has(edge.c)) take(edge);
  }

  const open = edges.filter((e) => !takenRow.has(e.h) && !takenCol.has(e.c));
  const tieScale = 1e-9 / ((historicalItems.length + 1) * (currentItems.length + 1));
  for (const group of connectedGroups(open, historicalItems.length)) {
    const k = Math.min(new Set(group.map((e) => e.h)).size, new Set(group.map((e) => e.c)).size);
    // Lexicographic objective as one weight. `cardinality` exceeds any sum of
    // scores, so one more represented item always beats a better score; the
    // attribute and id terms are too small to outweigh a real score difference.
    const cardinality = 2 * (k + 1);
    const perDimension = 1e-3 / (k + 1);
    const weight = (e: Edge) =>
      cardinality +
      e.result.score +
      e.result.comparedDimensions * perDimension +
      ((historicalItems.length - rowRank.get(e.h)!) * (currentItems.length + 1) + (currentItems.length - e.c)) *
        tieScale;
    for (const edge of solveAssignment(group, weight)) take(edge);
  }

  for (const [id, result] of best) {
    if (!assigned.has(id)) assigned.set(id, result);
  }
  return assigned;
}

interface Edge {
  /** Index into the historical items. */
  h: number;
  /** Index into the current items. */
  c: number;
  result: MatchResult;
}

/**
 * Splits the eligible pairs into groups that cannot affect each other. With
 * the default weights a group is roughly one brand and family, which keeps
 * each assignment problem small enough to solve on every recompute.
 */
function connectedGroups(edges: readonly Edge[], rowCount: number): Edge[][] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Columns are offset past the rows so both live in one id space.
  for (const e of edges) union(e.h, rowCount + e.c);

  const groups = new Map<number, Edge[]>();
  for (const e of edges) {
    const root = find(e.h);
    const list = groups.get(root);
    if (list) list.push(e);
    else groups.set(root, [e]);
  }
  return [...groups.values()];
}

/** The subset of `edges` that forms a one-to-one assignment of maximum total weight. */
function solveAssignment(edges: readonly Edge[], weight: (e: Edge) => number): Edge[] {
  const rows = [...new Set(edges.map((e) => e.h))].sort((a, b) => a - b);
  const cols = [...new Set(edges.map((e) => e.c))].sort((a, b) => a - b);

  // The solver needs rows <= columns, so the smaller side becomes the rows.
  const transpose = rows.length > cols.length;
  const side = transpose ? cols : rows;
  const other = transpose ? rows : cols;
  const sideIndex = new Map(side.map((x, i) => [x, i]));
  const otherIndex = new Map(other.map((x, i) => [x, i]));

  const byCell = new Map<string, Edge>();
  // A pair below threshold is simply absent: weight 0, so the solver only
  // "uses" it when there is nothing else, and it is dropped afterwards.
  const weights = side.map(() => new Array<number>(other.length).fill(0));
  for (const e of edges) {
    const i = sideIndex.get(transpose ? e.c : e.h)!;
    const j = otherIndex.get(transpose ? e.h : e.c)!;
    weights[i]![j] = weight(e);
    byCell.set(`${i}:${j}`, e);
  }

  const out: Edge[] = [];
  maxWeightAssignment(weights, other.length).forEach((j, i) => {
    const edge = byCell.get(`${i}:${j}`);
    if (edge) out.push(edge);
  });
  return out;
}

/**
 * Kuhn–Munkres (Hungarian) assignment, maximising total weight. `weights` is
 * n x m with n <= m; returns the column assigned to each row. O(n^2 m).
 */
function maxWeightAssignment(weights: readonly (readonly number[])[], m: number): number[] {
  const n = weights.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  // p[j]: the (1-based) row holding column j; p[0] is the row being placed.
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  const cost = (i: number, j: number) => -weights[i - 1]![j - 1]!;

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const reduced = cost(i0, j) - u[i0]! - v[j]!;
        if (reduced < minv[j]!) {
          minv[j] = reduced;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j]! > 0) rowToCol[p[j]! - 1] = j - 1;
  }
  return rowToCol;
}

/**
 * Builds the candidate list for a situation: every prior item in scope, with
 * its match, its proposed disposition, and any planner override applied.
 */
export function buildCandidates(
  historicalItems: readonly HistoricalItemRow[],
  currentItems: readonly CurrentPlanRow[],
  dispositions: Readonly<Record<string, ContributorDisposition>>,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
  pricePerUnit = 0
): CandidateItem[] {
  const assignments = assignRepresentation(historicalItems, currentItems, config);

  return historicalItems
    .map((row) => {
      const match = assignments.get(row.id) ?? { score: 0, comparedDimensions: 0, outcomes: [] };
      const proposed = proposeDisposition(row, match, config);
      const chosen = dispositions[row.id];
      return {
        id: row.id,
        itemId: row.itemId,
        itemName: row.itemName,
        brand: row.brand,
        productFamily: row.productFamily,
        historicalPeriod: row.historicalPeriod,
        actualUnits: row.actualUnits,
        actualValue: row.actualValue ?? row.actualUnits * pricePerUnit,
        // Matching does not resolve carry-forward volume — `collapseToSkus` in
        // ./volume does, and build.ts layers the result on top. The defaults
        // here keep a candidate self-consistent when it is built directly:
        // carry the prior actual forward unchanged.
        plannedUnits: row.actualUnits,
        plannedValue: row.actualValue ?? row.actualUnits * pricePerUnit,
        plannedBasis: {
          kind: "prior_actual",
          seasonsUsed: [row.historicalPeriod],
          baselineUnits: row.actualUnits,
          growthPct: 0,
          inferredUnits: row.actualUnits,
          label: "1 season · prior actual, no growth applied",
        },
        seasonHistory: [
          { period: row.historicalPeriod, units: row.actualUnits, value: row.actualValue },
        ],
        // Matching does not know which items have a bill of materials —
        // build.ts resolves that once it has the BOM index. `none` is the
        // honest default: it claims nothing until something is found.
        derivation: "none",
        analogues: [],
        derivationLabel: "",
        // Resolved in build.ts, which can see every season; matching sees one row.
        isNewThisSeason: false,
        disposition: chosen ?? proposed,
        proposedDisposition: proposed,
        match,
        customer: row.customer,
        channel: row.channel,
        packFormat: row.packFormat,
        basePack: row.basePack,
        formulaFamily: row.formulaFamily,
        primaryLineId: row.primaryLineId,
        status: row.status,
      } satisfies CandidateItem;
    })
    .sort((a, b) => b.actualValue - a.actualValue);
}
