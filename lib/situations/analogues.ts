/**
 * Analogous derivation for products with no bill of materials (V2 §17, §43).
 *
 * A product can be real enough to plan before it is specified enough to
 * explode. A renovation, a new pack, an item whose spec was never set up — the
 * volume is known, the components are not. The honest move is neither to drop
 * it (which understates the plan) nor to invent a BOM for it (which fabricates
 * precision), but to say *this is what comparable products need, and here is
 * how comparable they actually are*.
 *
 * Three rules this module exists to hold:
 *
 * - Similarity is explained by naming attributes, never by a bare percentage.
 *   A planner can argue with "different pack format"; they cannot argue with
 *   64%.
 * - The closest comparable leads the blend. A planner reading a BOM off four
 *   near-identical products at 25% each learns nothing about which one it is
 *   really copied from; a blend led by the closest, with a thinning tail, is
 *   the one they would build by hand.
 * - Confidence falls with disagreement. A component every analogue carries is
 *   better evidenced than one only the weakest of them does, and the two must
 *   never come out looking the same.
 *
 * Pure: no React, no `Date.now()`, no `Math.random()`.
 */

import type { BomRow, HistoricalItemRow } from "@/types/dataset";
import type { AnalogueMatch, InferredBomLine } from "@/types/situation";

/**
 * What makes two products comparable, and how much each attribute is worth.
 *
 * Weighted by how much each actually predicts a bill of materials: what a
 * product is made of dominates, what it is wrapped in follows, and who buys it
 * barely matters at all.
 */
const DIMENSIONS = [
  { key: "formulaFamily", label: "formulation", weight: 3 },
  { key: "productFamily", label: "product family", weight: 3 },
  { key: "packagingType", label: "packaging type", weight: 2 },
  { key: "packFormat", label: "pack format", weight: 2 },
  { key: "basePack", label: "base pack", weight: 2 },
  { key: "brand", label: "brand", weight: 1 },
  { key: "packSize", label: "pack size", weight: 1 },
  { key: "customer", label: "customer", weight: 0.5 },
] as const;

/** Below this the products are not comparable enough to derive anything from. */
const MIN_SIMILARITY = 0.35;
/** More than this and the tail adds noise rather than evidence. */
const MAX_ANALOGUES = 4;

/**
 * How the default blend is weighted. An analogue's weight is
 *
 *     similarity ^ SIMILARITY_SHARPNESS  ×  RANK_DECAY ^ rank
 *
 * normalised so the blend adds to 100%. Rank orders by similarity, then by the
 * most recent season, so two equally similar products never split the blend
 * evenly: the one that ran most recently is the better guide to what the new
 * one will be made of.
 *
 * With four near-identical analogues that puts ~62% on the closest, ~25% on
 * the next, and a thin tail — skewed enough to say which product the BOM is
 * really read from, while every analogue still counts toward confidence. The
 * sharpening makes a genuinely less similar product fall away faster than rank
 * alone would.
 */
export const SIMILARITY_SHARPNESS = 4;
export const RANK_DECAY = 0.4;

function attr(row: HistoricalItemRow, key: (typeof DIMENSIONS)[number]["key"]): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  return String(value).trim().toLowerCase() || undefined;
}

/**
 * When a comparable product last ran. Production start where the data has it —
 * a period key such as "2026-Valentine" does not sort in calendar order against
 * "2026-Holiday" — else the sales window, else the period itself.
 */
function recencyKey(row: HistoricalItemRow): string {
  return row.productionWindow?.start ?? row.salesWindow?.start ?? row.historicalPeriod;
}

/**
 * Ranks comparable products, explaining each one, and weights the default
 * blend toward the closest (see `RANK_DECAY`).
 *
 * Only products that actually have a BOM are offered: an analogue with nothing
 * to copy is not an analogue, and returning one would produce an item that
 * looks derived but explodes into nothing.
 */
export function findAnalogues(
  target: HistoricalItemRow,
  pool: readonly HistoricalItemRow[],
  bomByParent: ReadonlyMap<string, BomRow[]>,
  options: { excluded?: readonly string[]; limit?: number } = {}
): AnalogueMatch[] {
  const excluded = new Set(options.excluded ?? []);
  const scored: (AnalogueMatch & { recency: string })[] = [];

  for (const row of pool) {
    if (row.id === target.id) continue;
    if (!bomByParent.has(row.itemId)) continue;

    let matched = 0;
    let comparable = 0;
    const same: string[] = [];
    const different: string[] = [];

    for (const dim of DIMENSIONS) {
      const a = attr(target, dim.key);
      const b = attr(row, dim.key);
      // An attribute missing on either side is not evidence of similarity or
      // of difference, so it is left out of the denominator entirely.
      if (a === undefined || b === undefined) continue;
      comparable += dim.weight;
      if (a === b) {
        matched += dim.weight;
        same.push(dim.label);
      } else {
        different.push(dim.label);
      }
    }

    if (comparable === 0) continue;
    const similarity = matched / comparable;
    if (similarity < MIN_SIMILARITY) continue;

    scored.push({
      candidateId: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      period: row.historicalPeriod,
      similarity,
      same,
      different,
      componentCount: bomByParent.get(row.itemId)?.length ?? 0,
      excluded: excluded.has(row.id),
      weight: 0,
      recency: recencyKey(row),
    });
  }

  const ranked = scored
    .sort(
      (a, b) =>
        b.similarity - a.similarity ||
        b.recency.localeCompare(a.recency) ||
        a.itemName.localeCompare(b.itemName) ||
        a.candidateId.localeCompare(b.candidateId)
    )
    .slice(0, options.limit ?? MAX_ANALOGUES);

  const raw = ranked.map((a, rank) => a.similarity ** SIMILARITY_SHARPNESS * RANK_DECAY ** rank);
  const total = raw.reduce((sum, w) => sum + w, 0);

  return ranked.map((scoredRow, rank) => {
    const analogue: AnalogueMatch & { recency?: string } = { ...scoredRow };
    delete analogue.recency;
    // The default share of the blend. A planner's weight replaces it.
    return { ...analogue, weight: total > 0 ? (raw[rank] ?? 0) / total : 0 };
  });
}

/**
 * Blends the analogues' bills of materials into one inferred BOM.
 *
 * Quantities are a weighted mean across the analogues that carry the
 * component, not across all of them — averaging in a zero for a product that
 * simply does not use foil would quietly halve the foil requirement.
 *
 * Confidence is the share of analogue weight that carries the component at
 * all. That is the number that separates "every comparable product needs
 * cocoa" from "one of them happened to use a tin".
 */
export function blendAnalogueBoms(
  analogues: readonly AnalogueMatch[],
  bomByParent: ReadonlyMap<string, BomRow[]>
): InferredBomLine[] {
  const included = analogues.filter((a) => !a.excluded && a.weight > 0);
  const totalWeight = included.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight <= 0) return [];

  const accum = new Map<
    string,
    {
      row: BomRow;
      weightedQty: number;
      weightedScrap: number;
      carryingWeight: number;
      sources: { itemName: string; quantityPerParent: number }[];
    }
  >();

  for (const analogue of included) {
    for (const line of bomByParent.get(analogue.itemId) ?? []) {
      const existing = accum.get(line.componentId);
      const entry = existing ?? {
        row: line,
        weightedQty: 0,
        weightedScrap: 0,
        carryingWeight: 0,
        sources: [],
      };
      entry.weightedQty += line.quantityPerParent * analogue.weight;
      entry.weightedScrap += (line.scrapPct ?? 0) * analogue.weight;
      entry.carryingWeight += analogue.weight;
      entry.sources.push({ itemName: analogue.itemName, quantityPerParent: line.quantityPerParent });
      if (!existing) accum.set(line.componentId, entry);
    }
  }

  return [...accum.values()]
    .map((entry) => ({
      componentId: entry.row.componentId,
      componentName: entry.row.componentName,
      componentType: entry.row.componentType,
      componentFamily: entry.row.componentFamily,
      uom: entry.row.uom,
      // Divided by the weight that actually carries it, not the total.
      quantityPerParent: entry.weightedQty / entry.carryingWeight,
      scrapPct: entry.weightedScrap / entry.carryingWeight,
      planningStatus: entry.row.planningStatus,
      confidence: entry.carryingWeight / totalWeight,
      sources: entry.sources.sort((a, b) => b.quantityPerParent - a.quantityPerParent),
    }))
    .sort((a, b) => b.confidence - a.confidence || a.componentName.localeCompare(b.componentName));
}

/** Each included analogue's share of the blend, 0-1, keyed by its row id. */
export function blendShares(analogues: readonly AnalogueMatch[]): Map<string, number> {
  const included = analogues.filter((a) => !a.excluded && a.weight > 0);
  const total = included.reduce((sum, a) => sum + a.weight, 0);
  return new Map(included.map((a) => [a.candidateId, total > 0 ? a.weight / total : 0]));
}

/**
 * One line describing the derivation, for a screen that has to say where a
 * number came from before a planner will act on it. Names the product the
 * blend leads with and the share it carries — the same share the drawer shows.
 */
export function describeAnalogueBasis(analogues: readonly AnalogueMatch[]): string {
  const shares = blendShares(analogues);
  const included = analogues
    .filter((a) => shares.has(a.candidateId))
    .sort((a, b) => (shares.get(b.candidateId) ?? 0) - (shares.get(a.candidateId) ?? 0));
  const lead = included[0];
  if (!lead) return "No comparable product with a bill of materials was found.";

  const share = Math.round((shares.get(lead.candidateId) ?? 0) * 100);
  return included.length > 1
    ? `Read from ${included.length} comparable products, led by ${lead.itemName} (${share}% of the blend)`
    : `Read from ${lead.itemName}`;
}
