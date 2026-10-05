/**
 * Product lineage: which SKU records are one continuous planning requirement,
 * and why Heizen believes so.
 *
 * A relationship never arrives as a bare similarity score. Each attribute is
 * compared and shown — family matches, vendor matches, brand changed — so a
 * planner can see exactly what the match rests on and overrule it.
 *
 * Relationships come from three places, in precedence order:
 *   1. SKU_Transitions rows (a planner defined them)
 *   2. JDA's replacement field on the SKU master
 *   3. Heizen's own suggestion for a discontinued SKU with no recorded
 *      replacement — always unconfirmed until a planner says otherwise
 */

import type { PlanningDataset, SkuRow, TransitionRow } from "@/types/dataset";
import type {
  AttributeVerdict,
  Lineage,
  RelationshipConfidence,
  RelationshipEvidence,
  TransitionOverrides,
} from "@/types/transition";

/* ------------------------------------------------------------------ */
/* Attribute evidence                                                  */
/* ------------------------------------------------------------------ */

/** Words that name the branding rather than the product. */
const BRANDING_WORDS = new Set([
  "legacy",
  "branding",
  "branded",
  "scouting",
  "america",
  "bsa",
  "boy",
  "scouts",
  "new",
  "rebrand",
  "logo",
  "old",
  "—",
  "-",
]);

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !BRANDING_WORDS.has(w))
  );
}

/** Jaccard overlap of the descriptive words in two names. */
export function descriptionSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

function compare(attribute: string, a: string | undefined, b: string | undefined): RelationshipEvidence {
  if (a === undefined || b === undefined || a === "" || b === "") {
    return { attribute, verdict: "unknown", legacyValue: a, successorValue: b };
  }
  const same = a.trim().toLowerCase() === b.trim().toLowerCase();
  return { attribute, verdict: same ? "match" : "changed", legacyValue: a, successorValue: b };
}

/**
 * Attribute-by-attribute comparison of a legacy SKU and its successor. Order
 * is the order a planner reads it in: what makes them the same product first,
 * then what changed.
 */
export function compareSkus(legacy: SkuRow, successor: SkuRow): RelationshipEvidence[] {
  const similarity = descriptionSimilarity(legacy.skuName, successor.skuName);
  const description: AttributeVerdict = similarity >= 0.6 ? "strong" : similarity >= 0.34 ? "partial" : "changed";

  const identity: RelationshipEvidence[] = [
    compare("Product family", legacy.productFamily, successor.productFamily),
    compare("Category", legacy.category, successor.category),
    compare("Program", legacy.program, successor.program),
    compare("Size range", legacy.sizeRange, successor.sizeRange),
    compare("Vendor", legacy.vendor, successor.vendor),
    compare("Color", legacy.color, successor.color),
    { attribute: "Description", verdict: description, legacyValue: legacy.skuName, successorValue: successor.skuName },
    compare("Brand", legacy.brand, successor.brand),
    compare("Packaging", legacy.packaging, successor.packaging),
  ];
  const sku: RelationshipEvidence = {
    attribute: "SKU ID",
    verdict: "changed",
    legacyValue: legacy.skuId,
    successorValue: successor.skuId,
  };

  const rank = (e: RelationshipEvidence) =>
    e.verdict === "match" || e.verdict === "strong" ? 0 : e.verdict === "partial" ? 1 : e.verdict === "changed" ? 2 : 3;
  return [...identity.sort((x, y) => rank(x) - rank(y)), sku];
}

const IDENTITY = new Set(["Product family", "Category", "Program", "Size range", "Vendor"]);

/**
 * HIGH: same family and category, at least four matching attributes, and the
 * descriptions agree. MEDIUM: family or category agrees and three attributes
 * match. Anything less is LOW and should be investigated, not confirmed.
 */
export function relationshipConfidence(evidence: readonly RelationshipEvidence[]): RelationshipConfidence {
  const verdict = (attr: string) => evidence.find((e) => e.attribute === attr)?.verdict;
  const matched = evidence.filter(
    (e) => e.attribute !== "SKU ID" && (e.verdict === "match" || e.verdict === "strong")
  ).length;
  const identityMatched = evidence.filter((e) => IDENTITY.has(e.attribute) && e.verdict === "match").length;
  const familyAndCategory = verdict("Product family") === "match" && verdict("Category") === "match";
  const description = verdict("Description");
  if (familyAndCategory && matched >= 4 && (description === "strong" || description === "partial")) return "HIGH";
  if ((verdict("Product family") === "match" || verdict("Category") === "match") && identityMatched >= 2 && matched >= 3)
    return "MEDIUM";
  return "LOW";
}

/* ------------------------------------------------------------------ */
/* Collecting relationships                                            */
/* ------------------------------------------------------------------ */

/**
 * Every transition the product plans: the explicit rows, JDA's recorded
 * replacements not already covered, and Heizen's suggestions for discontinued
 * SKUs that nothing accounts for.
 */
export function collectTransitions(dataset: PlanningDataset): TransitionRow[] {
  const rows: TransitionRow[] = [...dataset.transitions];
  const covered = new Set<string>();
  for (const t of rows) {
    for (const id of t.predecessorSkuIds) covered.add(id);
    for (const id of t.successorSkuIds) covered.add(id);
  }
  const skuById = new Map(dataset.skus.map((s) => [s.skuId, s]));

  // JDA's replacement field — recorded in the system, so already confirmed.
  for (const sku of dataset.skus) {
    if (!sku.replacementSkuId || covered.has(sku.skuId)) continue;
    const successor = skuById.get(sku.replacementSkuId);
    if (!successor) continue;
    rows.push({
      transitionId: `sys-${sku.skuId}`,
      transitionName: productName(successor),
      predecessorSkuIds: [sku.skuId],
      successorSkuIds: [successor.skuId],
      transitionType: "ONE_TO_ONE",
      reason: "REPLACEMENT",
      startDate: sku.discontinueDate ?? successor.launchDate,
      plannerConfirmed: true,
      source: "SYSTEM",
    });
    covered.add(sku.skuId);
    covered.add(successor.skuId);
  }

  // Heizen's suggestions: a discontinued SKU nobody has mapped, matched to
  // the best-fitting new SKU nobody has mapped either. One-to-one, so a new
  // SKU never stands for two legacy products by accident.
  const orphans = dataset.skus.filter((s) => s.status === "DISCONTINUED" && !covered.has(s.skuId));
  const candidates = dataset.skus.filter((s) => (s.status === "NEW" || s.status === "ACTIVE") && !covered.has(s.skuId));
  const taken = new Set<string>();
  for (const legacy of orphans) {
    let best: { sku: SkuRow; score: number } | undefined;
    for (const candidate of candidates) {
      if (taken.has(candidate.skuId) || candidate.category !== legacy.category) continue;
      const evidence = compareSkus(legacy, candidate);
      const confidence = relationshipConfidence(evidence);
      if (confidence === "LOW") continue;
      const score =
        evidence.filter((e) => e.verdict === "match" || e.verdict === "strong").length +
        descriptionSimilarity(legacy.skuName, candidate.skuName);
      if (!best || score > best.score) best = { sku: candidate, score };
    }
    if (!best) continue;
    taken.add(best.sku.skuId);
    rows.push({
      transitionId: `sug-${legacy.skuId}`,
      // Named for what planners already call it — the legacy product.
      transitionName: productName(legacy),
      predecessorSkuIds: [legacy.skuId],
      successorSkuIds: [best.sku.skuId],
      transitionType: "ONE_TO_ONE",
      reason: "REPLACEMENT",
      startDate: legacy.discontinueDate ?? best.sku.launchDate,
      plannerConfirmed: false,
      source: "SUGGESTED",
    });
  }

  return rows;
}

/** A SKU's product name without the branding suffix: "Cub Scout Uniform Shirt". */
export function productName(sku: SkuRow): string {
  return sku.skuName.split(/\s+[—–-]\s+/)[0]?.trim() || sku.skuName;
}

/* ------------------------------------------------------------------ */
/* Applying the planner's decision                                     */
/* ------------------------------------------------------------------ */

/**
 * The relationship after the planner's decision. Discontinued drops the
 * successor (demand does not carry); new product drops the predecessor (there
 * is no history to carry). Neither deletes a SKU — they change what the math
 * treats as one stream.
 */
export function effectiveRelationship(
  row: TransitionRow,
  overrides: TransitionOverrides | undefined
): Pick<TransitionRow, "predecessorSkuIds" | "successorSkuIds" | "transitionType"> & { confirmed: boolean } {
  let predecessorSkuIds = row.predecessorSkuIds;
  let successorSkuIds = overrides?.successorSkuIds?.length ? overrides.successorSkuIds : row.successorSkuIds;
  let transitionType = row.transitionType;
  let confirmed = row.plannerConfirmed;

  if (overrides?.successorSkuIds?.length) {
    confirmed = true;
    transitionType =
      predecessorSkuIds.length > 1
        ? "MANY_TO_ONE"
        : successorSkuIds.length > 1
          ? "ONE_TO_MANY"
          : predecessorSkuIds.length === 0
            ? "NEW_PRODUCT"
            : "ONE_TO_ONE";
  }

  switch (overrides?.relationshipDecision) {
    case "CONFIRMED":
    case "PARTIAL_REPLACEMENT":
      confirmed = true;
      break;
    case "DISCONTINUED":
      successorSkuIds = [];
      transitionType = "NO_SUCCESSOR";
      confirmed = true;
      break;
    case "NEW_PRODUCT":
      predecessorSkuIds = [];
      transitionType = "NEW_PRODUCT";
      confirmed = true;
      break;
    case "INVESTIGATE":
      confirmed = false;
      break;
    default:
      break;
  }
  return { predecessorSkuIds, successorSkuIds, transitionType, confirmed };
}

export function buildLineage(
  row: TransitionRow,
  relationship: ReturnType<typeof effectiveRelationship>,
  skuById: ReadonlyMap<string, SkuRow>,
  overrides: TransitionOverrides | undefined
): Lineage {
  const predecessors = relationship.predecessorSkuIds
    .map((id) => skuById.get(id))
    .filter((s): s is SkuRow => s !== undefined);
  const successors = relationship.successorSkuIds
    .map((id) => skuById.get(id))
    .filter((s): s is SkuRow => s !== undefined);

  // The evidence compares the primary pair; for a split or a consolidation
  // the first of each side is the one the planner recognises.
  const primaryLegacy = predecessors[0] ?? skuById.get(row.predecessorSkuIds[0] ?? "");
  const primarySuccessor = successors[0] ?? skuById.get(row.successorSkuIds[0] ?? "");
  const evidence = primaryLegacy && primarySuccessor ? compareSkus(primaryLegacy, primarySuccessor) : [];
  const counted = evidence.filter((e) => e.attribute !== "SKU ID");

  return {
    type: relationship.transitionType,
    reason: row.reason,
    source: row.source,
    predecessors,
    successors,
    confirmed: relationship.confirmed,
    decision: overrides?.relationshipDecision,
    confidence: evidence.length > 0 ? relationshipConfidence(evidence) : "LOW",
    evidence,
    matchedCount: counted.filter((e) => e.verdict === "match" || e.verdict === "strong").length,
    changedCount: counted.filter((e) => e.verdict === "changed").length,
  };
}
